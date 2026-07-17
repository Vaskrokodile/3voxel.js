import {
  AIR,
  CHUNK_SIZE,
  CHUNK_VOLUME,
  type BlockId,
  type ChunkCoord,
} from '../core/types.js';
import { Palette } from './Palette.js';

/**
 * Local voxel index within a chunk.
 *
 * Index order (meshing depends on this — do not change without auditing the
 * mesher):
 *
 *   index = lx + lz * CHUNK_SIZE + ly * CHUNK_SIZE * CHUNK_SIZE
 *
 * i.e. x varies fastest, then z, then y. This is a Y-slice-major layout: a
 * horizontal Y layer is contiguous in memory, which is convenient for
 * column-based generation and meshing.
 *
 * @param lx  local x in [0, CHUNK_SIZE)
 * @param ly  local y in [0, CHUNK_SIZE)
 * @param lz  local z in [0, CHUNK_SIZE)
 */
export function localIndex(lx: number, ly: number, lz: number): number {
  return lx + lz * CHUNK_SIZE + ly * CHUNK_SIZE * CHUNK_SIZE;
}

/**
 * A single chunk's voxel data, compressed via a per-chunk palette.
 *
 * Storage is a typed array of palette indices of length CHUNK_VOLUME. The
 * palette index 0 always maps to AIR, so a freshly constructed chunk (all
 * zeros) is entirely AIR and costs ~CHUNK_VOLUME bytes (Uint8).
 *
 * When the palette grows past 256 distinct ids, the index array is migrated
 * from Uint8Array to Uint16Array so more than 256 block types can coexist in
 * one chunk. The palette itself caps at 65536 distinct ids.
 */
export class Chunk {
  readonly coord: ChunkCoord;
  readonly palette: Palette;

  /** Palette indices for every voxel. Uint8 until palette > 256, then Uint16. */
  private indices: Uint8Array | Uint16Array;

  constructor(coord: ChunkCoord) {
    this.coord = coord;
    this.palette = new Palette();
    // AIR is palette index 0 by construction; all voxels default to 0.
    this.indices = new Uint8Array(CHUNK_VOLUME);
  }

  /**
   * Bytes per voxel in the index array: 1 for Uint8, 2 for Uint16.
   * Determined by palette size (<=256 -> 1, >256 -> 2).
   */
  get bytesPerVoxel(): 1 | 2 {
    return this.indices instanceof Uint16Array ? 2 : 1;
  }

  /**
   * Get the block id at local coords. Returns AIR for out-of-range coords
   * (defensive; callers should stay in-range on the hot path).
   */
  getBlock(lx: number, ly: number, lz: number): BlockId {
    if (
      lx < 0 || lx >= CHUNK_SIZE ||
      ly < 0 || ly >= CHUNK_SIZE ||
      lz < 0 || lz >= CHUNK_SIZE
    ) {
      return AIR;
    }
    const i = lx + lz * CHUNK_SIZE + ly * CHUNK_SIZE * CHUNK_SIZE;
    const idx = this.indices[i] as number;
    return this.palette.getId(idx);
  }

  /**
   * Set the block id at local coords. Out-of-range writes are ignored.
   * May trigger a Uint8 -> Uint16 migration if the palette grows past 256.
   */
  setBlock(lx: number, ly: number, lz: number, id: BlockId): void {
    if (
      lx < 0 || lx >= CHUNK_SIZE ||
      ly < 0 || ly >= CHUNK_SIZE ||
      lz < 0 || lz >= CHUNK_SIZE
    ) {
      return;
    }
    const i = lx + lz * CHUNK_SIZE + ly * CHUNK_SIZE * CHUNK_SIZE;
    const paletteIndex = this.palette.add(id);
    // Migrate to Uint16 if needed (palette size > 256 means index >= 256
    // cannot fit in a byte).
    if (paletteIndex > 0xff && this.indices instanceof Uint8Array) {
      this.migrateToUint16();
    }
    (this.indices as Uint8Array | Uint16Array)[i] = paletteIndex;
  }

  /** Fill the entire chunk with a single block id. */
  fill(id: BlockId): void {
    const paletteIndex = this.palette.add(id);
    if (paletteIndex > 0xff && this.indices instanceof Uint8Array) {
      this.migrateToUint16();
    }
    this.indices.fill(paletteIndex);
  }

  /**
   * Fast check: true when the chunk contains only AIR (palette has <= 1 entry,
   * i.e. just AIR). Does not scan the index array.
   */
  isEmpty(): boolean {
    return this.palette.size <= 1;
  }

  /**
   * Approximate memory footprint in bytes: index array bytes + palette ids
   * array bytes + map overhead estimate. Used for budgeting.
   */
  getMemoryBytes(): number {
    const indexBytes = this.indices.byteLength;
    // ids array: BlockId[] stored as numbers; approximate as size * 8 bytes.
    const paletteIdsBytes = this.palette.size * 8;
    // Map overhead: rough estimate of 48 bytes per entry for a JS Map.
    const mapBytes = this.palette.size * 48;
    return indexBytes + paletteIdsBytes + mapBytes;
  }

  /** Migrate the index array from Uint8 to Uint16, preserving all values. */
  private migrateToUint16(): void {
    const old = this.indices as Uint8Array;
    const next = new Uint16Array(CHUNK_VOLUME);
    next.set(old);
    this.indices = next;
  }
}
