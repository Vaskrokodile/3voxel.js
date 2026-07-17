import { chunkKey, type ChunkCoord, type Vec3 } from '../core/types.js';
import type { BigChunkLike } from './BigChunk.js';

/** Supported chunk edge lengths in the mixed-size grid. */
export type ChunkSize = 16 | 32 | 64;

/**
 * A loaded chunk in the {@link ChunkGrid}, tagged with its size and LOD level.
 *
 * `lod` is 0 for the highest-detail (nearest) chunks, 1 for medium, 2 for the
 * lowest-detail (farthest) chunks.
 */
export interface ChunkGridEntry {
  readonly coord: ChunkCoord;
  readonly size: ChunkSize;
  readonly chunk: BigChunkLike;
  readonly lod: number;
}

/**
 * Sparse grid of mixed-size chunks. Each entry is keyed by its chunk coord
 * (in units of that chunk's own size), so a 32³ chunk at coord (1,0,0) covers
 * world voxels [32..63] on each axis. The grid supports range queries in
 * world space and a static LOD policy for choosing chunk size by distance.
 */
export class ChunkGrid {
  private readonly entries: Map<string, ChunkGridEntry> = new Map();

  /** Insert or replace a chunk at a grid position. */
  set(coord: ChunkCoord, size: ChunkSize, chunk: BigChunkLike): void {
    const lod = size === 16 ? 0 : size === 32 ? 1 : 2;
    this.entries.set(chunkKey(coord), { coord, size, chunk, lod });
  }

  /** Get the entry at a grid coord, or null if not loaded. */
  get(coord: ChunkCoord): ChunkGridEntry | null {
    const e = this.entries.get(chunkKey(coord));
    return e === undefined ? null : e;
  }

  /** Remove the entry at a grid coord. */
  delete(coord: ChunkCoord): void {
    this.entries.delete(chunkKey(coord));
  }

  /**
   * Return all entries whose world-space AABB intersects the query box
   * `[min, max]`. A chunk's world AABB is
   * `[chunkToWorld(coord, size), chunkToWorld(coord, size) + size]`.
   */
  queryRange(min: Vec3, max: Vec3): ChunkGridEntry[] {
    const out: ChunkGridEntry[] = [];
    for (const entry of this.entries.values()) {
      const w = ChunkGrid.chunkToWorld(entry.coord, entry.size);
      const ax = w.x + entry.size;
      const ay = w.y + entry.size;
      const az = w.z + entry.size;
      // Intersect [w, w+size] with [min, max] on each axis.
      if (
        w.x <= max.x && ax >= min.x &&
        w.y <= max.y && ay >= min.y &&
        w.z <= max.z && az >= min.z
      ) {
        out.push(entry);
      }
    }
    return out;
  }

  /**
   * Choose the optimal chunk size for a given distance from the camera.
   *
   *  - distance < 64  → 16 (high detail, near)
   *  - distance < 128 → 32 (medium)
   *  - distance >= 128 → 64 (low detail, far)
   */
  static optimalSize(distance: number): ChunkSize {
    if (distance < 64) return 16;
    if (distance < 128) return 32;
    return 64;
  }

  /**
   * Convert a world coordinate to the chunk coord that owns it, for a given
   * chunk size. Uses `Math.floor` for correct negative handling.
   */
  static worldToChunk(wx: number, wy: number, wz: number, size: ChunkSize): ChunkCoord {
    return {
      x: Math.floor(wx / size),
      y: Math.floor(wy / size),
      z: Math.floor(wz / size),
    };
  }

  /**
   * Convert a chunk coord to the world-space min corner of that chunk.
   */
  static chunkToWorld(coord: ChunkCoord, size: ChunkSize): Vec3 {
    return {
      x: coord.x * size,
      y: coord.y * size,
      z: coord.z * size,
    };
  }

  /** Number of loaded entries. */
  get size(): number {
    return this.entries.size;
  }

  /** Remove all entries. */
  clear(): void {
    this.entries.clear();
  }
}
