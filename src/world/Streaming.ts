/**
 * Chunk streaming: computes the desired set of chunks around the camera and
 * decides which chunks to unload.
 *
 * Shape: a SPHERE in chunk-space (Euclidean distance from the camera chunk).
 * This is chosen over a cube so diagonal chunks beyond the view radius are
 * excluded — important for small view distances where a cube would load far
 * more chunks at the corners than along the axes.
 *
 * All methods are pure and allocation-conscious: `computeDesired` reuses a
 * caller-provided output buffer when one is passed.
 */
import type { ChunkCoord } from '../core/types.js';

/** Options for the {@link Streaming} controller. */
export interface StreamingOptions {
  /** Render distance in CHUNKS (not world units). */
  readonly viewDistance: number;
  /** Max chunks to load/mesh per frame (budget). */
  readonly maxPerFrame: number;
  /** Extra chunk margin beyond viewDistance before unloading. */
  readonly unloadMargin: number;
}

/** A chunk coord paired with its squared distance to the camera (for sorting). */
interface DesiredEntry {
  readonly coord: ChunkCoord;
  readonly dist2: number;
}

/**
 * Pure streaming planner. Computes desired chunk coords (sphere, sorted by
 * distance to the camera chunk) and unload decisions.
 */
export class Streaming {
  readonly viewDistance: number;
  readonly maxPerFrame: number;
  readonly unloadMargin: number;

  constructor(opts: StreamingOptions) {
    this.viewDistance = opts.viewDistance;
    this.maxPerFrame = opts.maxPerFrame;
    this.unloadMargin = opts.unloadMargin;
  }

  /**
   * Compute the desired chunk set: all chunks within `viewDistance` (sphere,
   * in chunk-space) of `cameraChunk`, sorted nearest-first.
   *
   * @param cameraChunk The camera's chunk coordinate.
   * @returns Sorted array of chunk coords (nearest first). A fresh array is
   *          returned each call; callers may cache it.
   */
  computeDesired(cameraChunk: ChunkCoord): ChunkCoord[] {
    const r = Math.floor(this.viewDistance);
    const r2 = this.viewDistance * this.viewDistance;
    const entries: DesiredEntry[] = [];

    for (let dz = -r; dz <= r; dz++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 > r2) continue; // sphere
          entries.push({
            coord: {
              x: cameraChunk.x + dx,
              y: cameraChunk.y + dy,
              z: cameraChunk.z + dz,
            },
            dist2: d2,
          });
        }
      }
    }

    entries.sort((a, b) => a.dist2 - b.dist2);
    const out: ChunkCoord[] = new Array(entries.length);
    for (let i = 0; i < entries.length; i++) out[i] = entries[i]!.coord;
    return out;
  }

  /**
   * Whether a chunk should be unloaded: true when its chunk-space distance
   * from the camera exceeds `viewDistance + unloadMargin`.
   *
   * @param coord        Chunk to test.
   * @param cameraChunk  Camera chunk.
   */
  shouldUnload(coord: ChunkCoord, cameraChunk: ChunkCoord): boolean {
    const dx = coord.x - cameraChunk.x;
    const dy = coord.y - cameraChunk.y;
    const dz = coord.z - cameraChunk.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    const limit = this.viewDistance + this.unloadMargin;
    return d2 > limit * limit;
  }
}
