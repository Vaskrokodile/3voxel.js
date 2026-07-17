import { AIR, CHUNK_SIZE, type BlockId } from '../core/types.js';
import type { BigChunkLike } from './BigChunk.js';

/**
 * Serialized form of a big chunk (or a single 16³ sub-chunk). The `blocks`
 * array holds palette indices into `paletteIds`; `subChunks` is the number of
 * 16³ sub-chunks the serialization covers (1 for a single sub-chunk,
 * `size³/16³` for a whole chunk).
 */
export interface SerializedBigChunk {
  readonly size: number;
  readonly blocks: Uint8Array;
  readonly paletteIds: Uint8Array;
  readonly subChunks: number;
}

/**
 * Serialize big chunks (or individual 16³ sub-chunks) into a compact
 * palette-index form suitable for handing off to a mesher worker. The output
 * uses a fresh local palette so the consumer does not need access to the
 * chunk's internal palette object.
 */
export class BigChunkSerializer {
  /**
   * Serialize an entire chunk. The `blocks` array is `size³` palette indices
   * into `paletteIds`.
   */
  serialize(chunk: BigChunkLike): SerializedBigChunk {
    const size = chunk.size;
    const volume = size * size * size;
    return this.serializeRegion(chunk, 0, 0, 0, size, volume, size * size * size / (16 * 16 * 16));
  }

  /**
   * Serialize a single 16³ sub-chunk identified by its sub-chunk indices
   * `(sx, sy, sz)` (each in `[0, size/16)`). The `blocks` array is 4096
   * palette indices into `paletteIds`.
   */
  serializeSubChunk(
    chunk: BigChunkLike,
    sx: number,
    sy: number,
    sz: number,
  ): SerializedBigChunk {
    const subPerAxis = chunk.size >> 4;
    if (
      sx < 0 || sx >= subPerAxis ||
      sy < 0 || sy >= subPerAxis ||
      sz < 0 || sz >= subPerAxis
    ) {
      throw new RangeError(
        `serializeSubChunk: (${sx},${sy},${sz}) out of range for size ${chunk.size}`,
      );
    }
    const originX = sx * 16;
    const originY = sy * 16;
    const originZ = sz * 16;
    return this.serializeRegion(chunk, originX, originY, originZ, 16, 16 * 16 * 16, 1);
  }

  private serializeRegion(
    chunk: BigChunkLike,
    originX: number,
    originY: number,
    originZ: number,
    edge: number,
    volume: number,
    subChunks: number,
  ): SerializedBigChunk {
    // Build a local palette: BlockId -> index, index -> BlockId.
    const idToIndex = new Map<BlockId, number>();
    idToIndex.set(AIR, 0);
    const paletteIds: BlockId[] = [AIR];

    const blocks = new Uint8Array(volume);
    let out = 0;
    for (let ly = 0; ly < edge; ly++) {
      for (let lz = 0; lz < edge; lz++) {
        for (let lx = 0; lx < edge; lx++) {
          const id = chunk.getBlock(originX + lx, originY + ly, originZ + lz);
          let idx = idToIndex.get(id);
          if (idx === undefined) {
            idx = paletteIds.length;
            if (idx > 255) {
              throw new Error(
                'BigChunkSerializer: sub-chunk palette exceeds 256 entries',
              );
            }
            paletteIds.push(id);
            idToIndex.set(id, idx);
          }
          blocks[out] = idx;
          out++;
        }
      }
    }

    return {
      size: edge,
      blocks,
      paletteIds: Uint8Array.from(paletteIds),
      subChunks,
    };
  }
}

// Re-exported so consumers of this module know the sub-chunk edge length.
export const SUB_CHUNK_SIZE = CHUNK_SIZE;
