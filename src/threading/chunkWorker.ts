/**
 * chunkWorker.ts — worker entry point for off-main-thread meshing.
 *
 * On a MeshRequest it:
 *   1. Reconstructs a minimal VoxelChunkLike (SerializedChunk) from the
 *      transferred `blocks` (palette indices) + `paletteIds` (BlockId palette).
 *   2. Builds a BlockRegistry from the optional `blockFlags` / `blockMeshType`
 *      descriptors (per palette index) so the worker can classify transparent
 *      and cross blocks. When descriptors are absent it falls back to a
 *      default registry where every non-AIR block is an opaque cube.
 *   3. Builds a NeighborSampler from the optional `neighborShells` (1-voxel
 *      border shells of the 6 neighbor chunks) so faces between two solid
 *      chunks across chunk boundaries are culled (seam stitching). When no
 *      shells are provided, out-of-chunk neighbors are treated as AIR.
 *   4. Runs GreedyMesher and posts a MeshResult, transferring the vertex and
 *      index ArrayBuffers (zero-copy), plus the cross geometry buffers.
 */

import { AIR, CHUNK_SIZE, CHUNK_VOLUME } from '../core/types.js';
import type { BlockId, ChunkCoord } from '../core/types.js';
import { GreedyMesher } from '../meshing/GreedyMesher.js';
import type { BlockRegistryLike, BlockTypeLike, VoxelChunkLike } from '../meshing/types.js';
import type { MeshRequest, MeshResult, WorkerInbound } from './messages.js';

/** Bit positions in MeshRequest.blockFlags. */
const FLAG_SOLID = 1;
const FLAG_TRANSPARENT = 2;
const FLAG_OPAQUE_FACES = 4;
/** meshType codes used in MeshRequest.blockMeshType. */
const MESH_NONE = 0;
const MESH_CUBE = 1;
const MESH_CROSS = 2;

/** Number of entries per neighbor face shell (CHUNK_SIZE * CHUNK_SIZE). */
const SHELL_FACE = CHUNK_SIZE * CHUNK_SIZE;
/** Direction indices into the packed neighborShells array. */
const DIR_NX = 0;
const DIR_PX = 1;
const DIR_NY = 2;
const DIR_PY = 3;
const DIR_NZ = 4;
const DIR_PZ = 5;

/**
 * Minimal chunk reconstructed from transferred palette data.
 * `blocks` is a Uint8Array of palette indices (length CHUNK_VOLUME);
 * `paletteIds` maps each index to a BlockId.
 */
class SerializedChunk implements VoxelChunkLike {
  readonly coord: ChunkCoord;
  private readonly blocks: Uint8Array;
  private readonly paletteIds: Uint32Array;

  constructor(coord: ChunkCoord, blocks: Uint8Array, paletteIds: Uint32Array) {
    this.coord = coord;
    this.blocks = blocks;
    this.paletteIds = paletteIds;
  }

  getBlock(lx: number, ly: number, lz: number): BlockId {
    if (
      lx < 0 || lx >= CHUNK_SIZE ||
      ly < 0 || ly >= CHUNK_SIZE ||
      lz < 0 || lz >= CHUNK_SIZE
    ) {
      return AIR;
    }
    const idx = lx + lz * CHUNK_SIZE + ly * CHUNK_SIZE * CHUNK_SIZE;
    const paletteIndex = this.blocks[idx] ?? 0;
    return this.paletteIds[paletteIndex] ?? AIR;
  }
}

/** Default block registry: AIR is air, everything else is an opaque cube. */
class DefaultBlockRegistry implements BlockRegistryLike {
  private readonly cache = new Map<BlockId, BlockTypeLike>();

  get(id: BlockId): BlockTypeLike | undefined {
    if (id === AIR) {
      return {
        id: AIR,
        name: 'air',
        solid: false,
        transparent: false,
        opaqueFaces: false,
        meshType: 'none',
      };
    }
    let t = this.cache.get(id);
    if (t === undefined) {
      t = {
        id,
        name: `block_${id}`,
        solid: true,
        transparent: false,
        opaqueFaces: true,
        meshType: 'cube',
      };
      this.cache.set(id, t);
    }
    return t;
  }
}

/**
 * Registry built from the per-palette descriptors carried in the MeshRequest.
 * `blockFlags` / `blockMeshType` are indexed by palette index; the palette is
 * `paletteIds`. Falls back to the default opaque-cube shape for any palette
 * entry missing descriptor data. Exported for unit testing.
 */
export class DescriptorBlockRegistry implements BlockRegistryLike {
  private readonly cache = new Map<BlockId, BlockTypeLike>();
  private readonly paletteIds: Uint32Array;
  private readonly flags: Uint8Array | undefined;
  private readonly meshTypes: Uint8Array | undefined;

  constructor(
    paletteIds: Uint32Array,
    flags: Uint8Array | undefined,
    meshTypes: Uint8Array | undefined,
  ) {
    this.paletteIds = paletteIds;
    this.flags = flags;
    this.meshTypes = meshTypes;
  }

  get(id: BlockId): BlockTypeLike | undefined {
    if (id === AIR) {
      return {
        id: AIR,
        name: 'air',
        solid: false,
        transparent: false,
        opaqueFaces: false,
        meshType: 'none',
      };
    }
    const cached = this.cache.get(id);
    if (cached !== undefined) return cached;
    const t = this.buildType(id);
    this.cache.set(id, t);
    return t;
  }

  private buildType(id: BlockId): BlockTypeLike {
    // Find the palette index for this block id.
    let palIdx = -1;
    for (let i = 0; i < this.paletteIds.length; i++) {
      if (this.paletteIds[i] === id) {
        palIdx = i;
        break;
      }
    }
    const flags = palIdx >= 0 ? this.flags?.[palIdx] : undefined;
    const mt = palIdx >= 0 ? this.meshTypes?.[palIdx] : undefined;
    const solid = flags !== undefined ? (flags & FLAG_SOLID) !== 0 : true;
    const transparent = flags !== undefined ? (flags & FLAG_TRANSPARENT) !== 0 : false;
    const opaqueFaces = flags !== undefined ? (flags & FLAG_OPAQUE_FACES) !== 0 : true;
    let meshType: BlockTypeLike['meshType'] = 'cube';
    if (mt === MESH_NONE) meshType = 'none';
    else if (mt === MESH_CROSS) meshType = 'cross';
    else if (mt === MESH_CUBE) meshType = 'cube';
    return { id, name: `block_${id}`, solid, transparent, opaqueFaces, meshType };
  }
}

const defaultRegistry = new DefaultBlockRegistry();
const defaultMesher = new GreedyMesher(defaultRegistry);

/** NeighborSampler that returns AIR for all out-of-chunk world coords. */
const airSampler = (): BlockId => AIR;

/**
 * Build a NeighborSampler backed by the transferred neighbor shells. The
 * sampler answers in-chunk queries from `chunk` and out-of-chunk queries (one
 * step along a single axis) from the corresponding face shell. Samples that
 * fall on chunk corners/edges (out of range in two axes) or beyond the shells
 * return AIR — this only affects AO accuracy at chunk corners, never face
 * visibility. Exported for unit testing.
 */
export function makeShellSampler(
  chunk: VoxelChunkLike,
  worldOrigin: Readonly<{ x: number; y: number; z: number }>,
  shells: Uint32Array,
): (wx: number, wy: number, wz: number) => BlockId {
  const ox = worldOrigin.x;
  const oy = worldOrigin.y;
  const oz = worldOrigin.z;
  const S = CHUNK_SIZE;
  return (wx: number, wy: number, wz: number): BlockId => {
    const lx = wx - ox;
    const ly = wy - oy;
    const lz = wz - oz;
    if (lx >= 0 && lx < S && ly >= 0 && ly < S && lz >= 0 && lz < S) {
      return chunk.getBlock(lx, ly, lz);
    }
    // -x / +x faces: in-plane axes are y, z.
    if (ly >= 0 && ly < S && lz >= 0 && lz < S) {
      if (lx === -1) return shells[DIR_NX * SHELL_FACE + ly * S + lz] ?? AIR;
      if (lx === S) return shells[DIR_PX * SHELL_FACE + ly * S + lz] ?? AIR;
    }
    // -y / +y faces: in-plane axes are x, z.
    if (lx >= 0 && lx < S && lz >= 0 && lz < S) {
      if (ly === -1) return shells[DIR_NY * SHELL_FACE + lx * S + lz] ?? AIR;
      if (ly === S) return shells[DIR_PY * SHELL_FACE + lx * S + lz] ?? AIR;
    }
    // -z / +z faces: in-plane axes are x, y.
    if (lx >= 0 && lx < S && ly >= 0 && ly < S) {
      if (lz === -1) return shells[DIR_NZ * SHELL_FACE + lx * S + ly] ?? AIR;
      if (lz === S) return shells[DIR_PZ * SHELL_FACE + lx * S + ly] ?? AIR;
    }
    return AIR;
  };
}

// Install the message handler only when running inside a Worker global
// (`self`). In non-worker environments (e.g. unit tests importing this module
// for its exported helpers) `self` is undefined, so the guard skips the
// side-effecting top-level assignment.
if (typeof self !== 'undefined') {
  self.onmessage = (ev: MessageEvent<WorkerInbound>): void => {
    const msg = ev.data;
    if (msg === undefined || msg === null) return;

    switch (msg.type) {
      case 'mesh': {
        handleMesh(msg);
        break;
      }
      case 'gen': {
        // Generation is handled by another module; the worker only implements
        // meshing for now. Forwarding is a TODO once the generation module lands.
        break;
      }
      default: {
        // Exhaustiveness check for the discriminated union.
        const _exhaustive: never = msg;
        void _exhaustive;
      }
    }
  };
}

function handleMesh(req: MeshRequest): void {
  if (req.blocks.length !== CHUNK_VOLUME) {
    // Malformed request — post an empty result so the caller isn't stalled.
    const empty: MeshResult = {
      type: 'meshResult',
      id: req.id,
      chunk: req.chunkCoord,
      vertices: new Uint8Array(0),
      indices: new Uint8Array(0),
      indexFormat: 'uint16',
      vertexCount: 0,
      indexCount: 0,
      opaqueIndexCount: 0,
      transparentIndexCount: 0,
      crossVertices: new Uint8Array(0),
      crossIndices: new Uint8Array(0),
      crossIndexFormat: 'uint16',
      crossVertexCount: 0,
      crossIndexCount: 0,
    };
    postResult(empty);
    return;
  }

  const chunk = new SerializedChunk(req.chunkCoord, req.blocks, req.paletteIds);

  // Pick a mesher: use a descriptor-backed registry when the request carries
  // block descriptors, otherwise the default opaque-cube mesher.
  let mesher = defaultMesher;
  if (req.blockFlags !== undefined || req.blockMeshType !== undefined) {
    const registry = new DescriptorBlockRegistry(
      req.paletteIds,
      req.blockFlags,
      req.blockMeshType,
    );
    mesher = new GreedyMesher(registry);
  }

  // Pick a neighbor sampler: shell-backed when neighborShells are provided,
  // otherwise the legacy AIR sampler.
  const sampler =
    req.neighborShells !== undefined && req.neighborShells.length >= 6 * SHELL_FACE
      ? makeShellSampler(chunk, req.worldOrigin, req.neighborShells)
      : airSampler;

  const meshed = mesher.mesh(chunk, req.worldOrigin, sampler);

  const result: MeshResult = {
    type: 'meshResult',
    id: req.id,
    chunk: meshed.chunk,
    vertices: meshed.vertices,
    indices: meshed.indices,
    indexFormat: meshed.indexFormat,
    vertexCount: meshed.vertexCount,
    indexCount: meshed.indexCount,
    opaqueIndexCount: meshed.opaqueIndexCount,
    transparentIndexCount: meshed.transparentIndexCount,
    crossVertices: meshed.crossVertices,
    crossIndices: meshed.crossIndices,
    crossIndexFormat: meshed.crossIndexFormat,
    crossVertexCount: meshed.crossVertexCount,
    crossIndexCount: meshed.crossIndexCount,
  };
  postResult(result);
}

function postResult(result: MeshResult): void {
  // Transfer the underlying ArrayBuffers (zero-copy, detaches the worker's
  // views — the worker must not touch these buffers after posting).
  const transferables: Transferable[] = [
    result.vertices.buffer,
    result.indices.buffer,
  ];
  if (result.crossVertices && result.crossVertices.length > 0) {
    transferables.push(result.crossVertices.buffer);
  }
  if (result.crossIndices && result.crossIndices.length > 0) {
    transferables.push(result.crossIndices.buffer);
  }
  (self as unknown as Worker).postMessage(result, transferables);
}
