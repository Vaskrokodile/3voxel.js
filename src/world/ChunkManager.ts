/**
 * Chunk lifecycle manager.
 *
 * Owns per-chunk state and drives the streaming budget each `update()`:
 *   Empty -> Generating -> Generated -> Meshing -> Ready
 * and unloads chunks beyond the margin.
 *
 * The manager does NOT import the voxel Chunk class; it talks to the voxel
 * world through {@link VoxelWorldLike} and serializes chunks for the mesh
 * worker through an injected {@link ChunkSerializer}.
 *
 * Cross-chunk neighbor meshing (seam stitching): when submitting a chunk for
 * meshing the manager extracts the 1-voxel border shells of the chunk's 6
 * neighbors from the voxel world and ships them in the MeshRequest. The worker
 * uses them to cull faces between two solid chunks across chunk boundaries.
 * Neighbors that are not yet loaded read as AIR, so edge faces are emitted
 * until the neighbor loads and the chunk is re-meshed (see requestRemesh).
 */
import type { BlockId, ChunkCoord, Logger, Vec3 } from '../core/types.js';
import { CHUNK_SIZE, chunkKey } from '../core/types.js';
import type {
  ChunkMeshDataLike,
  ChunkSerializer,
  VoxelChunkLike,
  VoxelWorldLike,
  WorkerPoolLike,
} from './types.js';
import type { TerrainGenerator } from '../generation/TerrainGenerator.js';
import { Streaming } from './Streaming.js';
import { lodTierFor, LODTier } from './LOD.js';

/**
 * Per-block descriptor the manager can provide so the mesh worker classifies
 * blocks (solid / transparent / opaque / cross) without importing the real
 * registry. Structurally compatible with meshing.BlockDescriptor.
 */
export interface BlockDescriptorEntry {
  readonly solid: boolean;
  readonly transparent: boolean;
  readonly opaqueFaces: boolean;
  readonly meshType: 'none' | 'cube' | 'cross';
}

/** Provider mapping a BlockId to its descriptor. */
export type BlockDescriptorProvider = (id: BlockId) => BlockDescriptorEntry | undefined;

/**
 * Worker pool surface used by the manager. Extends {@link WorkerPoolLike} with
 * optional neighbor-shell and block-descriptor payloads on the mesh request so
 * the worker can perform cross-chunk face culling and transparent/cross
 * classification. The extra fields are optional, so any WorkerPoolLike whose
 * mesh accepts the base fields is structurally assignable (method bivariance).
 */
export interface MeshWorkerPool extends WorkerPoolLike {
  mesh(req: {
    readonly chunkCoord: ChunkCoord;
    readonly worldOrigin: Vec3;
    readonly blocks: Uint8Array;
    readonly paletteIds: Uint8Array;
    readonly neighborShells?: Uint32Array | undefined;
    readonly blockFlags?: Uint8Array | undefined;
    readonly blockMeshType?: Uint8Array | undefined;
  }): Promise<ChunkMeshDataLike>;
}

/** Number of entries per neighbor face shell (CHUNK_SIZE * CHUNK_SIZE). */
const SHELL_FACE = CHUNK_SIZE * CHUNK_SIZE;
/** Direction indices into the packed neighborShells array. */
const DIR_NX = 0;
const DIR_PX = 1;
const DIR_NY = 2;
const DIR_PY = 3;
const DIR_NZ = 4;
const DIR_PZ = 5;
/** blockFlags bitfield: bit 0 = solid, bit 1 = transparent, bit 2 = opaqueFaces. */
const FLAG_SOLID = 1;
const FLAG_TRANSPARENT = 2;
const FLAG_OPAQUE_FACES = 4;
/** blockMeshType codes: 0 = none, 1 = cube, 2 = cross. */
const MESH_NONE = 0;
const MESH_CUBE = 1;
const MESH_CROSS = 2;

/** Lifecycle state of a managed chunk. */
export enum ChunkState {
  /** No state yet / not tracked. */
  Empty = 0,
  /** Terrain generation in progress. */
  Generating = 1,
  /** Terrain generated, awaiting mesh. */
  Generated = 2,
  /** Mesh job submitted to the worker pool. */
  Meshing = 3,
  /** Mesh ready for the renderer. */
  Ready = 4,
  /** Marked for unload (will be dropped next update). */
  Unloading = 5,
}

/** Per-chunk tracked record. */
interface ChunkRecord {
  state: ChunkState;
  coord: ChunkCoord;
  mesh?: ChunkMeshDataLike | undefined;
  /** In-flight mesh promise, if Meshing. */
  promise?: Promise<void> | undefined;
}

/** Default streaming options if not overridden by the caller. */
const DEFAULT_VIEW_DISTANCE = 8; // chunks
const DEFAULT_MAX_PER_FRAME = 2;
const DEFAULT_UNLOAD_MARGIN = 2;

/**
 * Drives chunk generation + meshing + unloading around the camera.
 */
export class ChunkManager {
  private readonly world: VoxelWorldLike;
  private readonly gen: TerrainGenerator;
  private readonly pool: MeshWorkerPool;
  private readonly serializer: ChunkSerializer;
  private readonly descriptorProvider: BlockDescriptorProvider | undefined;
  private readonly logger: Logger | undefined;
  private readonly streaming: Streaming;
  private readonly chunks = new Map<string, ChunkRecord>();
  private readonly viewDistanceWorld: number;
  /** Reusable scratch array for distance-sorted mesh submission (no per-frame alloc). */
  private readonly generatedScratch: ChunkRecord[] = [];

  constructor(opts: {
    readonly world: VoxelWorldLike;
    readonly gen: TerrainGenerator;
    readonly pool: MeshWorkerPool;
    readonly serializer: ChunkSerializer;
    /** Optional per-block descriptor provider for worker-side transparent/cross classification. */
    readonly blockDescriptorProvider?: BlockDescriptorProvider;
    readonly logger?: Logger;
    readonly viewDistance?: number;
    readonly maxPerFrame?: number;
    readonly unloadMargin?: number;
  }) {
    this.world = opts.world;
    this.gen = opts.gen;
    this.pool = opts.pool;
    this.serializer = opts.serializer;
    this.descriptorProvider = opts.blockDescriptorProvider;
    this.logger = opts.logger;
    const vd = opts.viewDistance ?? DEFAULT_VIEW_DISTANCE;
    this.streaming = new Streaming({
      viewDistance: vd,
      maxPerFrame: opts.maxPerFrame ?? DEFAULT_MAX_PER_FRAME,
      unloadMargin: opts.unloadMargin ?? DEFAULT_UNLOAD_MARGIN,
    });
    // World-space view distance for LOD tiering (chunks * CHUNK_SIZE).
    this.viewDistanceWorld = vd * 16;
  }

  /**
   * Ensure a single chunk is on the path to Ready. Useful for force-loading
   * the camera's chunk immediately. Does not block; progress happens in
   * {@link ChunkManager.update}.
   */
  ensureReady(coord: ChunkCoord, _cameraPos: Vec3): void {
    const key = chunkKey(coord);
    let rec = this.chunks.get(key);
    if (!rec) {
      rec = { state: ChunkState.Empty, coord };
      this.chunks.set(key, rec);
    }
    this.advance(rec);
  }

  /**
   * Run one streaming tick.
   *
   * - Computes the desired chunk set around `cameraPos` (sphere, sorted).
   * - Up to `maxPerFrame` chunks not yet started are advanced Empty->Generating.
   * - Resolves any completed mesh promises into Ready.
   * - Unloads chunks beyond the margin.
   *
   * @param cameraPos Camera world position.
   * @param _dt       Delta time in seconds (reserved for future rate limiting).
   */
  update(cameraPos: Vec3, _dt: number): void {
    const cameraChunk: ChunkCoord = {
      x: Math.floor(cameraPos.x / 16),
      y: Math.floor(cameraPos.y / 16),
      z: Math.floor(cameraPos.z / 16),
    };

    // 1. Unload chunks beyond the margin.
    this.unloadDistant(cameraChunk);

    // 2. Resolve completed mesh promises.
    this.resolveMeshes();

    // 3. Compute desired set and start up to maxPerFrame new chunks.
    const desired = this.streaming.computeDesired(cameraChunk);
    let started = 0;
    for (let i = 0; i < desired.length && started < this.streaming.maxPerFrame; i++) {
      const coord = desired[i]!;
      const key = chunkKey(coord);
      let rec = this.chunks.get(key);
      if (!rec) {
        rec = { state: ChunkState.Empty, coord };
        this.chunks.set(key, rec);
      }
      if (rec.state === ChunkState.Empty) {
        this.advance(rec);
        started++;
      }
    }

    // 4. Advance Generated chunks that have budget, ordered by distance to
    //    the camera (nearest first) so the player's immediate surroundings
    //    mesh before far-away chunks. Up to `maxPerFrame` mesh submissions are
    //    batched per frame; the worker pool throttles actual work via `busy`.
    this.advanceGeneratedBatch(cameraChunk);
  }

  /**
   * Collect all chunks in the Generated state, sort them by squared distance
   * to the camera chunk (nearest first), and submit up to `maxPerFrame` of
   * them for meshing in one batch. Reuses a scratch array to avoid
   * per-frame allocation of the candidate list (the sort buffer is allocated
   * only when the candidate count grows).
   */
  private advanceGeneratedBatch(cameraChunk: ChunkCoord): void {
    const scratch = this.generatedScratch;
    scratch.length = 0;
    for (const rec of this.chunks.values()) {
      if (rec.state === ChunkState.Generated) scratch.push(rec);
    }
    if (scratch.length === 0) return;
    // Sort nearest-first by squared chunk-space distance.
    scratch.sort((a, b) => {
      const ax = a.coord.x - cameraChunk.x;
      const ay = a.coord.y - cameraChunk.y;
      const az = a.coord.z - cameraChunk.z;
      const bx = b.coord.x - cameraChunk.x;
      const by = b.coord.y - cameraChunk.y;
      const bz = b.coord.z - cameraChunk.z;
      return (ax * ax + ay * ay + az * az) - (bx * bx + by * by + bz * bz);
    });
    const limit = Math.min(this.streaming.maxPerFrame, scratch.length);
    for (let i = 0; i < limit; i++) {
      this.advance(scratch[i]!);
    }
  }

  /**
   * Drain and return all meshes that have become Ready since the last call.
   * The caller uploads them to the GPU and clears its stale chunk meshes.
   */
  getReadyMeshes(): ChunkMeshDataLike[] {
    const out: ChunkMeshDataLike[] = [];
    for (const rec of this.chunks.values()) {
      if (rec.state === ChunkState.Ready && rec.mesh) {
        out.push(rec.mesh);
        // Keep the mesh in the record (renderer may ask again) but mark it
        // as already handed off by leaving state Ready. Callers that want
        // one-shot delivery should track which keys they've uploaded.
      }
    }
    return out;
  }

  /** Current number of tracked chunks (any state). */
  get chunkCount(): number {
    return this.chunks.size;
  }

  /** Look up a chunk record's state (mainly for tests). */
  stateOf(coord: ChunkCoord): ChunkState | undefined {
    return this.chunks.get(chunkKey(coord))?.state;
  }

  // ---- internal ----

  /** Advance a chunk one step along the pipeline. */
  private advance(rec: ChunkRecord): void {
    switch (rec.state) {
      case ChunkState.Empty:
        rec.state = ChunkState.Generating;
        // Synchronous generation (cheap enough for pass 1; could be moved to
        // a worker later). ensureChunk returns/creates the chunk in the voxel
        // world; we generate into it immediately.
        try {
          const chunk = this.world.ensureChunk(rec.coord);
          this.gen.generate(chunk);
          rec.state = ChunkState.Generated;
          // Immediately try to submit the mesh.
          this.advance(rec);
        } catch (e) {
          this.log('error', 'chunk generation failed', {
            coord: rec.coord,
            err: String(e),
          });
          rec.state = ChunkState.Empty;
        }
        break;
      case ChunkState.Generating:
        // In-flight; nothing to do (synchronous path above resolves immediately).
        break;
      case ChunkState.Generated: {
        rec.state = ChunkState.Meshing;
        const chunk: VoxelChunkLike = this.world.ensureChunk(rec.coord);
        const { blocks, paletteIds } = this.serializer.serialize(chunk);
        const worldOrigin = {
          x: rec.coord.x * CHUNK_SIZE,
          y: rec.coord.y * CHUNK_SIZE,
          z: rec.coord.z * CHUNK_SIZE,
        };
        const neighborShells = this.buildNeighborShells(worldOrigin);
        const descriptors = this.buildBlockDescriptors(paletteIds);
        rec.promise = this.pool
          .mesh({
            chunkCoord: rec.coord,
            worldOrigin,
            blocks,
            paletteIds,
            neighborShells,
            blockFlags: descriptors?.flags,
            blockMeshType: descriptors?.meshTypes,
          })
          .then((mesh) => {
            rec.mesh = mesh;
            rec.state = ChunkState.Ready;
          })
          .catch((e) => {
            this.log('error', 'mesh failed', { coord: rec.coord, err: String(e) });
            rec.state = ChunkState.Generated; // retry next tick
          });
        break;
      }
      case ChunkState.Meshing:
        // Waiting on worker; resolved in resolveMeshes().
        break;
      case ChunkState.Ready:
        // Nothing to do. (LOD tier could trigger a re-mesh here in future.)
        break;
      case ChunkState.Unloading:
        // Will be dropped in unloadDistant.
        break;
      default:
        break;
    }
  }

  /**
   * Force a chunk to be re-meshed. Called when blocks in the chunk change
   * (e.g. player breaks/places a block). Resets the chunk to the Generated
   * state so the next `update()` re-submits it for meshing. If the chunk
   * is not tracked or is already being re-meshed, this is a no-op.
   */
  requestRemesh(coord: ChunkCoord): void {
    const key = chunkKey(coord);
    const rec = this.chunks.get(key);
    if (!rec) return;
    // Only re-mesh chunks that have been generated (Ready or Generated).
    if (rec.state === ChunkState.Ready || rec.state === ChunkState.Generated) {
      rec.state = ChunkState.Generated;
      rec.mesh = undefined;
      rec.promise = undefined;
    }
  }

  /** Resolve any settled mesh promises (state transitions handled in .then). */
  private resolveMeshes(): void {
    // Promise callbacks set state directly; this is a no-op placeholder that
    // keeps the update loop explicit. We iterate to allow future synchronous
    // resolution hooks.
    for (const rec of this.chunks.values()) {
      if (rec.state === ChunkState.Meshing && rec.promise === undefined) {
        // Stale record without a promise; reset to Generated for retry.
        rec.state = ChunkState.Generated;
      }
    }
  }

  /** Unload chunks beyond viewDistance + unloadMargin. */
  private unloadDistant(cameraChunk: ChunkCoord): void {
    const toDelete: string[] = [];
    for (const [key, rec] of this.chunks) {
      if (this.streaming.shouldUnload(rec.coord, cameraChunk)) {
        rec.state = ChunkState.Unloading;
        if (this.world.unloadChunk) this.world.unloadChunk(rec.coord);
        toDelete.push(key);
      }
    }
    for (let i = 0; i < toDelete.length; i++) {
      this.chunks.delete(toDelete[i]!);
    }
  }

  /**
   * Extract the 1-voxel border shells of the 6 neighbor chunks touching the
   * chunk at `worldOrigin`. Each face is CHUNK_SIZE*CHUNK_SIZE BlockIds read
   * from the voxel world (unloaded neighbors read as AIR). Packed into a
   * single Uint32Array of length 6*SHELL_FACE, ordered
   * [-x, +x, -y, +y, -z, +z]; within each face, indexed by
   * (inPlaneA * CHUNK_SIZE + inPlaneB) where the in-plane axes are the two
   * axes other than the face normal (see threading/messages.ts).
   */
  private buildNeighborShells(worldOrigin: Vec3): Uint32Array {
    const world = this.world;
    const ox = worldOrigin.x;
    const oy = worldOrigin.y;
    const oz = worldOrigin.z;
    const S = CHUNK_SIZE;
    const shells = new Uint32Array(6 * SHELL_FACE);
    // x faces: in-plane axes y, z.
    for (let y = 0; y < S; y++) {
      for (let z = 0; z < S; z++) {
        shells[DIR_NX * SHELL_FACE + y * S + z] = world.getBlock(ox - 1, oy + y, oz + z);
        shells[DIR_PX * SHELL_FACE + y * S + z] = world.getBlock(ox + S, oy + y, oz + z);
      }
    }
    // y faces: in-plane axes x, z.
    for (let x = 0; x < S; x++) {
      for (let z = 0; z < S; z++) {
        shells[DIR_NY * SHELL_FACE + x * S + z] = world.getBlock(ox + x, oy - 1, oz + z);
        shells[DIR_PY * SHELL_FACE + x * S + z] = world.getBlock(ox + x, oy + S, oz + z);
      }
    }
    // z faces: in-plane axes x, y.
    for (let x = 0; x < S; x++) {
      for (let y = 0; y < S; y++) {
        shells[DIR_NZ * SHELL_FACE + x * S + y] = world.getBlock(ox + x, oy + y, oz - 1);
        shells[DIR_PZ * SHELL_FACE + x * S + y] = world.getBlock(ox + x, oy + y, oz + S);
      }
    }
    return shells;
  }

  /**
   * Build per-palette block descriptor arrays (blockFlags bitfield +
   * blockMeshType code) from the descriptor provider. Returns undefined when
   * no provider is configured (the worker then falls back to its default
   * opaque-cube registry).
   */
  private buildBlockDescriptors(
    paletteIds: Uint8Array,
  ): { flags: Uint8Array; meshTypes: Uint8Array } | undefined {
    const provider = this.descriptorProvider;
    if (provider === undefined) return undefined;
    const n = paletteIds.length;
    const flags = new Uint8Array(n);
    const meshTypes = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const id = paletteIds[i] ?? 0;
      const d = provider(id);
      if (d === undefined) {
        // Unknown block: default to opaque cube (worker fallback).
        flags[i] = FLAG_SOLID | FLAG_OPAQUE_FACES;
        meshTypes[i] = MESH_CUBE;
        continue;
      }
      let f = 0;
      if (d.solid) f |= FLAG_SOLID;
      if (d.transparent) f |= FLAG_TRANSPARENT;
      if (d.opaqueFaces) f |= FLAG_OPAQUE_FACES;
      flags[i] = f;
      let mt = MESH_CUBE;
      if (d.meshType === 'none') mt = MESH_NONE;
      else if (d.meshType === 'cross') mt = MESH_CROSS;
      else if (d.meshType === 'cube') mt = MESH_CUBE;
      meshTypes[i] = mt;
    }
    return { flags, meshTypes };
  }

  private log(level: 'debug' | 'info' | 'warn' | 'error', msg: string, ctx?: Record<string, unknown>): void {
    this.logger?.log(level, msg, ctx);
  }
}

export { LODTier, lodTierFor };
