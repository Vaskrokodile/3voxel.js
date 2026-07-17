import { chunkKey, type ChunkCoord } from '../core/types.js';
import type { Chunk } from './Chunk.js';

/**
 * Sparse chunk map. The world does NOT hold all chunks in memory; this is a
 * `Map<string, Chunk>` keyed by `chunkKey(coord)`. Provides iteration and
 * memory accounting for budgeting.
 */
export class ChunkStorage {
  private readonly chunks: Map<string, Chunk> = new Map();

  /** Get the chunk at a coord, or undefined if not loaded. */
  get(coord: ChunkCoord): Chunk | undefined {
    return this.chunks.get(chunkKey(coord));
  }

  /** Insert/replace a chunk at a coord. */
  set(coord: ChunkCoord, chunk: Chunk): void {
    this.chunks.set(chunkKey(coord), chunk);
  }

  /** True if a chunk is loaded at the coord. */
  has(coord: ChunkCoord): boolean {
    return this.chunks.has(chunkKey(coord));
  }

  /** Remove a chunk from storage. */
  delete(coord: ChunkCoord): void {
    this.chunks.delete(chunkKey(coord));
  }

  /** Number of loaded chunks. */
  get size(): number {
    return this.chunks.size;
  }

  /** Iterate over [chunkKey, chunk] pairs. */
  [Symbol.iterator](): IterableIterator<[string, Chunk]> {
    return this.chunks[Symbol.iterator]();
  }

  /** Invoke a callback for each loaded chunk. */
  forEach(callback: (chunk: Chunk, key: string) => void): void {
    this.chunks.forEach((chunk, key) => callback(chunk, key));
  }

  /** Total approximate memory used by all stored chunks. */
  getMemoryBytes(): number {
    let total = 0;
    for (const [, chunk] of this.chunks) {
      total += chunk.getMemoryBytes();
    }
    return total;
  }
}
