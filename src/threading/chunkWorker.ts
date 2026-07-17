/**
 * chunkWorker.ts — worker entry point for off-main-thread meshing.
 *
 * On a MeshRequest it:
 *   1. Reconstructs a minimal VoxelChunkLike (SerializedChunk) from the
 *      transferred `blocks` (palette indices) + `paletteIds` (BlockId palette).
 *   2. Builds a NeighborSampler that returns AIR for any out-of-chunk world
 *      coordinate (cross-chunk neighbor culling is NOT performed in-worker
 *      because neighbor chunks are not sent — see tradeoff note below).
 *   3. Runs GreedyMesher and posts a MeshResult, transferring the vertex and
 *      index ArrayBuffers (zero-copy).
 *
 * Block-type registry: the worker does not yet receive per-block metadata
 * (solid/transparent/opaqueFaces/meshType). It uses a default registry where
 * every non-AIR block is treated as an opaque cube. This means transparent
 * blocks (water/glass) are meshed as opaque in-worker. TODO: extend the
 * MeshRequest protocol to carry block descriptors so the worker can classify
 * transparent blocks. Main-thread meshing (with the real registry) is correct.
 *
 * Tradeoff — cross-chunk neighbor culling: because only the target chunk's
 * blocks are transferred, edge faces always see AIR neighbors and are emitted.
 * The main thread should re-mesh border chunks once their neighbors load so
 * shared faces between two solid chunks get culled. This keeps per-mesh
 * transfers small at the cost of some over-draw until border re-meshing runs.
 */

import { AIR, CHUNK_SIZE, CHUNK_VOLUME } from '../core/types.js';
import type { BlockId, ChunkCoord } from '../core/types.js';
import { GreedyMesher } from '../meshing/GreedyMesher.js';
import type { BlockRegistryLike, BlockTypeLike, VoxelChunkLike } from '../meshing/types.js';
import type { MeshRequest, MeshResult, WorkerInbound } from './messages.js';

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

const registry = new DefaultBlockRegistry();
const mesher = new GreedyMesher(registry);

/** NeighborSampler that returns AIR for all out-of-chunk world coords. */
const airSampler = (): BlockId => AIR;

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
    };
    postResult(empty);
    return;
  }

  const chunk = new SerializedChunk(req.chunkCoord, req.blocks, req.paletteIds);
  const meshed = mesher.mesh(chunk, req.worldOrigin, airSampler);

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
  };
  postResult(result);
}

function postResult(result: MeshResult): void {
  // Transfer the underlying ArrayBuffers (zero-copy, detaches the worker's
  // views — the worker must not touch these buffers after posting).
  const transferables: Transferable[] = [result.vertices.buffer, result.indices.buffer];
  (self as unknown as Worker).postMessage(result, transferables);
}
