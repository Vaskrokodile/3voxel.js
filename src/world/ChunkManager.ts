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
 * FUTURE WORK (not faked here):
 *   - Cross-chunk neighbor meshing (seam stitching). The current mesher is
 *     assumed to handle borders via the world's getBlock or a neighbor
 *     snapshot; this manager only ships single-chunk data.
 *   - Merged-LOD meshes (see LOD.ts).
 */
import type { ChunkCoord, Logger, Vec3 } from '../core/types.js';
import { chunkKey } from '../core/types.js';
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
  private readonly pool: WorkerPoolLike;
  private readonly serializer: ChunkSerializer;
  private readonly logger: Logger | undefined;
  private readonly streaming: Streaming;
  private readonly chunks = new Map<string, ChunkRecord>();
  private readonly viewDistanceWorld: number;

  constructor(opts: {
    readonly world: VoxelWorldLike;
    readonly gen: TerrainGenerator;
    readonly pool: WorkerPoolLike;
    readonly serializer: ChunkSerializer;
    readonly logger?: Logger;
    readonly viewDistance?: number;
    readonly maxPerFrame?: number;
    readonly unloadMargin?: number;
  }) {
    this.world = opts.world;
    this.gen = opts.gen;
    this.pool = opts.pool;
    this.serializer = opts.serializer;
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

    // 4. Advance any Generated chunks that have budget (mesh submission is
    //    cheap; the worker pool throttles actual work via `busy`).
    for (const rec of this.chunks.values()) {
      if (rec.state === ChunkState.Generated) {
        this.advance(rec);
      }
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
          x: rec.coord.x * 16,
          y: rec.coord.y * 16,
          z: rec.coord.z * 16,
        };
        rec.promise = this.pool
          .mesh({ chunkCoord: rec.coord, worldOrigin, blocks, paletteIds })
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

  private log(level: 'debug' | 'info' | 'warn' | 'error', msg: string, ctx?: Record<string, unknown>): void {
    this.logger?.log(level, msg, ctx);
  }
}

export { LODTier, lodTierFor };
