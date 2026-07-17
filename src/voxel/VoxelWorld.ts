import {
  AIR,
  CHUNK_SIZE,
  type BlockId,
  type ChunkCoord,
} from '../core/types.js';
import { Chunk } from './Chunk.js';
import { ChunkStorage } from './ChunkStorage.js';
import type { BlockRegistry } from './BlockRegistry.js';

/**
 * Result of splitting a world coordinate into its owning chunk and the
 * local coordinate within that chunk.
 */
export interface WorldCoordSplit {
  readonly chunk: ChunkCoord;
  readonly local: { readonly lx: number; readonly ly: number; readonly lz: number };
}

/**
 * Convert a world axis coordinate into chunk + local components.
 *
 * Formula (per axis):
 *
 *   chunkCoord = Math.floor(worldCoord / CHUNK_SIZE)
 *   localCoord = worldCoord - chunkCoord * CHUNK_SIZE
 *
 * `Math.floor` is REQUIRED for correct negative handling. Using `| 0` or
 * `Math.trunc` would truncate toward zero and misplace negative coordinates
 * (e.g. world -1 would map to chunk 0 local -1 instead of chunk -1 local 15).
 *
 * Example: world = -1, CHUNK_SIZE = 16
 *   chunk = floor(-1/16) = -1
 *   local = -1 - (-1*16) = 15
 */
export function worldToChunk(wx: number, wy: number, wz: number): WorldCoordSplit {
  const cx = Math.floor(wx / CHUNK_SIZE);
  const cy = Math.floor(wy / CHUNK_SIZE);
  const cz = Math.floor(wz / CHUNK_SIZE);
  const lx = wx - cx * CHUNK_SIZE;
  const ly = wy - cy * CHUNK_SIZE;
  const lz = wz - cz * CHUNK_SIZE;
  return {
    chunk: { x: cx, y: cy, z: cz },
    local: { lx, ly, lz },
  };
}

/**
 * The voxel world: ties a sparse {@link ChunkStorage} to a
 * {@link BlockRegistry} and provides world-space block access that resolves
 * the owning chunk + local coords.
 *
 * `getBlock` returns AIR when the owning chunk is not loaded (the world is
 * sparse). `setBlock` on an absent chunk is a no-op (use `ensureChunk` first).
 */
export class VoxelWorld {
  readonly storage: ChunkStorage;
  readonly registry: BlockRegistry;

  constructor(registry: BlockRegistry) {
    this.registry = registry;
    this.storage = new ChunkStorage();
  }

  /**
   * Get the block id at a world coordinate. Returns AIR if the owning chunk
   * is not loaded. Handles negative world coordinates correctly.
   */
  getBlock(wx: number, wy: number, wz: number): BlockId {
    const { chunk, local } = worldToChunk(wx, wy, wz);
    const c = this.storage.get(chunk);
    if (c === undefined) {
      return AIR;
    }
    return c.getBlock(local.lx, local.ly, local.lz);
  }

  /**
   * Set the block id at a world coordinate. If the owning chunk is not
   * loaded, this is a no-op (callers should `ensureChunk` first when they
   * want to write into a not-yet-loaded region).
   */
  setBlock(wx: number, wy: number, wz: number, id: BlockId): void {
    const { chunk, local } = worldToChunk(wx, wy, wz);
    const c = this.storage.get(chunk);
    if (c === undefined) {
      return;
    }
    c.setBlock(local.lx, local.ly, local.lz, id);
  }

  /** Get the loaded chunk that owns a world coordinate, or undefined. */
  getChunkAt(wx: number, wy: number, wz: number): Chunk | undefined {
    const { chunk } = worldToChunk(wx, wy, wz);
    return this.storage.get(chunk);
  }

  /**
   * Get or create the chunk that owns a world coordinate. The new chunk is
   * all-AIR until written.
   */
  ensureChunk(coord: ChunkCoord): Chunk {
    const existing = this.storage.get(coord);
    if (existing !== undefined) {
      return existing;
    }
    const created = new Chunk(coord);
    this.storage.set(coord, created);
    return created;
  }

  /** Remove a chunk from storage (used by the streaming/unload system). */
  unloadChunk(coord: ChunkCoord): void {
    this.storage.delete(coord);
  }
}
