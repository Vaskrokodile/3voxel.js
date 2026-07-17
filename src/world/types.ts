/**
 * Local interface contracts for the world/streaming layer.
 *
 * These mirror sibling modules (voxel, meshing, threading) that are being
 * built in parallel. The world layer codes against these local interfaces so
 * it does not import sibling modules at typecheck time. The demo wires the
 * real implementations via constructor injection.
 */
import type {
  BlockId,
  ChunkCoord,
  ChunkMeshData,
  Logger,
  Vec3,
} from '../core/types.js';

/** Minimal voxel-world surface used by the world/streaming layer. */
export interface VoxelWorldLike {
  ensureChunk(coord: ChunkCoord): VoxelChunkLike;
  getBlock(wx: number, wy: number, wz: number): BlockId;
  setBlock(wx: number, wy: number, wz: number, id: BlockId): void;
  /** Optional: remove a chunk from the world (used by unload). */
  unloadChunk?(coord: ChunkCoord): void;
}

/** Minimal chunk surface used by the world/streaming layer. */
export interface VoxelChunkLike {
  readonly coord: ChunkCoord;
  getBlock(lx: number, ly: number, lz: number): BlockId;
  setBlock(lx: number, ly: number, lz: number, id: BlockId): void;
}

/** Block registry surface used by generation. */
export interface BlockRegistryLike {
  get(id: BlockId): BlockTypeLike;
  getByName(name: string): BlockTypeLike | undefined;
}

/** Block type descriptor. */
export interface BlockTypeLike {
  readonly id: BlockId;
  readonly name: string;
  readonly solid: boolean;
  readonly transparent: boolean;
}

/**
 * Mesh data produced by the mesher. Aliases the core {@link ChunkMeshData}
 * so the world layer does not invent a parallel shape.
 */
export type ChunkMeshDataLike = ChunkMeshData;

/** Worker pool surface used by the world/streaming layer. */
export interface WorkerPoolLike {
  mesh(req: {
    readonly chunkCoord: ChunkCoord;
    readonly worldOrigin: Vec3;
    readonly blocks: Uint8Array;
    readonly paletteIds: Uint8Array;
  }): Promise<ChunkMeshDataLike>;
  /** Number of in-flight mesh jobs. */
  readonly busy: number;
}

/**
 * Serializes a chunk into the compact form expected by the mesh worker.
 *
 * The world layer does NOT import the voxel Chunk class (to avoid a hard
 * dependency); instead the demo provides a serializer that produces:
 *   - `blocks`:    Uint8Array of length CHUNK_VOLUME — per-voxel palette
 *                  indices into `paletteIds`.
 *   - `paletteIds`: Uint8Array of the palette's BlockIds (index 0 should be
 *                  AIR so unset voxels are cheap).
 *
 * This keeps the chunk-internal representation (palette layout, index width)
 * owned by the voxel module while the world layer only transports bytes.
 */
export interface ChunkSerializer {
  serialize(chunk: VoxelChunkLike): {
    readonly blocks: Uint8Array;
    readonly paletteIds: Uint8Array;
  };
}

/** Re-export Logger for convenience. */
export type { Logger };
