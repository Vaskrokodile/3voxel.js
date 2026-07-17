import { AIR, type BlockId, type ChunkCoord } from '../core/types.js';
import { Palette } from '../voxel/Palette.js';

/** Edge length of a 32³ chunk. */
export const CHUNK_SIZE_32 = 32;
/** Edge length of a 64³ chunk. */
export const CHUNK_SIZE_64 = 64;

/**
 * Read-only view of a 16³ sub-region of a larger chunk. The mesher consumes
 * these so it can reuse the existing 16³ greedy mesher on 32³/64³ chunks.
 */
export interface SubChunkView {
  /** Local x of the sub-chunk's min corner within the parent chunk. */
  readonly originX: number;
  /** Local y of the sub-chunk's min corner within the parent chunk. */
  readonly originY: number;
  /** Local z of the sub-chunk's min corner within the parent chunk. */
  readonly originZ: number;
  /** Get the block id at local coords within this 16³ view (0..15). */
  getBlock(lx: number, ly: number, lz: number): BlockId;
}

/**
 * Common interface for chunks larger than 16³. Supports sub-chunk extraction
 * for meshing with the existing 16³ greedy mesher.
 */
export interface BigChunkLike {
  readonly size: number;
  readonly coord: ChunkCoord;
  getBlock(lx: number, ly: number, lz: number): BlockId;
  setBlock(lx: number, ly: number, lz: number, id: BlockId): void;
  getSubChunk(sx: number, sy: number, sz: number): SubChunkView;
  fill(generator: (lx: number, ly: number, lz: number) => BlockId): void;
  get solidCount(): number;
  get isEmpty(): boolean;
}

/**
 * Linear voxel index inside a chunk of edge `size`.
 *
 *   index = lx + lz * size + ly * size * size
 *
 * x varies fastest, then z, then y (Y-slice-major), matching the existing
 * 16³ convention.
 */
export function bigLocalIndex(lx: number, ly: number, lz: number, size: number): number {
  return lx + lz * size + ly * size * size;
}

/**
 * A concrete {@link SubChunkView} bound to a parent {@link BigChunkLike}.
 * Reads delegate to the parent's `getBlock` with the origin offset applied.
 */
class SubChunkViewImpl implements SubChunkView {
  readonly originX: number;
  readonly originY: number;
  readonly originZ: number;
  private readonly parent: BigChunkLike;

  constructor(parent: BigChunkLike, originX: number, originY: number, originZ: number) {
    this.parent = parent;
    this.originX = originX;
    this.originY = originY;
    this.originZ = originZ;
  }

  getBlock(lx: number, ly: number, lz: number): BlockId {
    if (lx < 0 || lx >= 16 || ly < 0 || ly >= 16 || lz < 0 || lz >= 16) {
      return AIR;
    }
    return this.parent.getBlock(
      this.originX + lx,
      this.originY + ly,
      this.originZ + lz,
    );
  }
}

/**
 * Shared implementation for palette-backed big chunks. Storage is a
 * Uint8Array of palette indices sized `size³`. When the palette grows past
 * 256 entries the index array migrates to Uint16Array.
 *
 * Memory: a full Chunk32 is ~32KB (32768 index bytes + palette); a full
 * Chunk64 is ~256KB (262144 index bytes + palette).
 */
abstract class BigChunkBase implements BigChunkLike {
  abstract readonly size: number;
  readonly coord: ChunkCoord;
  protected readonly palette: Palette;
  protected indices: Uint8Array | Uint16Array;
  protected solid: number = 0;

  constructor(coord: ChunkCoord, volume: number) {
    this.coord = coord;
    this.palette = new Palette();
    this.indices = new Uint8Array(volume);
  }

  getBlock(lx: number, ly: number, lz: number): BlockId {
    const size = this.size;
    if (
      lx < 0 || lx >= size ||
      ly < 0 || ly >= size ||
      lz < 0 || lz >= size
    ) {
      return AIR;
    }
    const i = lx + lz * size + ly * size * size;
    const idx = this.indices[i] as number;
    return this.palette.getId(idx);
  }

  setBlock(lx: number, ly: number, lz: number, id: BlockId): void {
    const size = this.size;
    if (
      lx < 0 || lx >= size ||
      ly < 0 || ly >= size ||
      lz < 0 || lz >= size
    ) {
      return;
    }
    const i = lx + lz * size + ly * size * size;
    const prevId = this.palette.getId(this.indices[i] as number);
    const paletteIndex = this.palette.add(id);
    if (paletteIndex > 0xff && this.indices instanceof Uint8Array) {
      this.migrateToUint16();
    }
    (this.indices as Uint8Array | Uint16Array)[i] = paletteIndex;
    if (prevId === AIR && id !== AIR) {
      this.solid++;
    } else if (prevId !== AIR && id === AIR) {
      this.solid--;
    }
  }

  getSubChunk(sx: number, sy: number, sz: number): SubChunkView {
    const subPerAxis = this.size >> 4; // size / 16
    if (
      sx < 0 || sx >= subPerAxis ||
      sy < 0 || sy >= subPerAxis ||
      sz < 0 || sz >= subPerAxis
    ) {
      throw new RangeError(
        `getSubChunk: (${sx},${sy},${sz}) out of range for size ${this.size}`,
      );
    }
    return new SubChunkViewImpl(this, sx * 16, sy * 16, sz * 16);
  }

  fill(generator: (lx: number, ly: number, lz: number) => BlockId): void {
    const size = this.size;
    this.solid = 0;
    for (let ly = 0; ly < size; ly++) {
      for (let lz = 0; lz < size; lz++) {
        for (let lx = 0; lx < size; lx++) {
          const id = generator(lx, ly, lz);
          const paletteIndex = this.palette.add(id);
          if (paletteIndex > 0xff && this.indices instanceof Uint8Array) {
            this.migrateToUint16();
          }
          (this.indices as Uint8Array | Uint16Array)[
            lx + lz * size + ly * size * size
          ] = paletteIndex;
          if (id !== AIR) {
            this.solid++;
          }
        }
      }
    }
  }

  get solidCount(): number {
    return this.solid;
  }

  get isEmpty(): boolean {
    return this.solid === 0;
  }

  private migrateToUint16(): void {
    const old = this.indices as Uint8Array;
    const next = new Uint16Array(old.length);
    next.set(old);
    this.indices = next;
  }
}

/**
 * A 32³ chunk (32768 voxels). Uses a palette + Uint8Array(32768) of indices,
 * migrating to Uint16Array when the palette exceeds 256 entries.
 *
 * Meshed as 8 × 16³ sub-chunks via {@link getSubChunk}.
 */
export class Chunk32 extends BigChunkBase {
  readonly size = CHUNK_SIZE_32;

  constructor(coord: ChunkCoord) {
    super(coord, CHUNK_SIZE_32 * CHUNK_SIZE_32 * CHUNK_SIZE_32);
  }
}

/**
 * A 64³ chunk (262144 voxels). Uses a palette + Uint8Array(262144) of indices,
 * migrating to Uint16Array when the palette exceeds 256 entries.
 *
 * Meshed as 64 × 16³ sub-chunks via {@link getSubChunk}.
 */
export class Chunk64 extends BigChunkBase {
  readonly size = CHUNK_SIZE_64;

  constructor(coord: ChunkCoord) {
    super(coord, CHUNK_SIZE_64 * CHUNK_SIZE_64 * CHUNK_SIZE_64);
  }
}
