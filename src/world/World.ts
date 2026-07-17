/**
 * High-level world facade.
 *
 * Wires a {@link TerrainGenerator}, {@link ChunkManager}, and the injected
 * voxel world + worker pool + serializer into a single `update()` /
 * `getReadyMeshes()` surface for the renderer/game loop.
 */
import type { ChunkCoord, Logger, Vec3 } from '../core/types.js';
import type {
  BlockRegistryLike,
  ChunkMeshDataLike,
  ChunkSerializer,
  VoxelWorldLike,
  WorkerPoolLike,
} from './types.js';
import { TerrainGenerator } from '../generation/TerrainGenerator.js';
import { ChunkManager } from './ChunkManager.js';

/** Options for constructing a {@link World}. */
export interface WorldOptions {
  readonly seed: number;
  readonly registry: BlockRegistryLike;
  readonly world: VoxelWorldLike;
  readonly pool: WorkerPoolLike;
  readonly serializer: ChunkSerializer;
  readonly logger?: Logger;
  readonly viewDistance?: number;
  readonly maxPerFrame?: number;
  readonly unloadMargin?: number;
  /** Optional pre-built generator (otherwise built from `seed` + `registry`). */
  readonly generator?: TerrainGenerator;
}

/**
 * World facade. Delegates streaming + mesh retrieval to a {@link ChunkManager}.
 */
export class World {
  private readonly manager: ChunkManager;

  constructor(opts: WorldOptions) {
    const generator = opts.generator ?? new TerrainGenerator(opts.seed, opts.registry);
    this.manager = new ChunkManager({
      world: opts.world,
      gen: generator,
      pool: opts.pool,
      serializer: opts.serializer,
      ...(opts.logger !== undefined ? { logger: opts.logger } : {}),
      ...(opts.viewDistance !== undefined ? { viewDistance: opts.viewDistance } : {}),
      ...(opts.maxPerFrame !== undefined ? { maxPerFrame: opts.maxPerFrame } : {}),
      ...(opts.unloadMargin !== undefined ? { unloadMargin: opts.unloadMargin } : {}),
    });
  }

  /** Advance streaming by one frame. */
  update(cameraPos: Vec3, dt: number): void {
    this.manager.update(cameraPos, dt);
  }

  /** Drain newly-ready chunk meshes. */
  getReadyMeshes(): ChunkMeshDataLike[] {
    return this.manager.getReadyMeshes();
  }

  /** Force a chunk to begin loading (e.g. the camera's chunk). */
  ensureReady(coord: ChunkCoord, cameraPos: Vec3): void {
    this.manager.ensureReady(coord, cameraPos);
  }

  /**
   * Force a chunk to be re-meshed. Called when blocks in the chunk change
   * (e.g. player breaks/places a block).
   */
  requestRemesh(coord: ChunkCoord): void {
    this.manager.requestRemesh(coord);
  }

  /** Number of tracked chunks (any state). */
  get chunkCount(): number {
    return this.manager.chunkCount;
  }
}
