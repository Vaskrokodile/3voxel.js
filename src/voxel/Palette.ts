import { AIR, type BlockId } from '../core/types.js';

/**
 * Per-chunk block palette. Maps `BlockId -> small index` and back so a chunk
 * can store compact index arrays instead of full block ids.
 *
 * Invariants:
 *  - Index 0 ALWAYS maps to AIR (BlockId 0). AIR is pre-registered in the
 *    constructor and never removed.
 *  - `size` is the number of distinct block ids in the palette (including AIR).
 *  - Indices are dense and contiguous: 0..size-1.
 */
export class Palette {
  /** index -> BlockId. ids[0] === AIR. */
  private readonly ids: BlockId[] = [AIR];
  /** BlockId -> index. */
  private readonly index: Map<BlockId, number> = new Map([[AIR, 0]]);

  /**
   * Add a block id to the palette, returning its index. If the id is already
   * present, returns the existing index without mutating the palette.
   */
  add(id: BlockId): number {
    const existing = this.index.get(id);
    if (existing !== undefined) {
      return existing;
    }
    const next = this.ids.length;
    if (next >= 65536) {
      throw new Error(`Palette: distinct block count cap (65536) exceeded`);
    }
    this.ids.push(id);
    this.index.set(id, next);
    return next;
  }

  /**
   * Get the palette index for a block id, or -1 if the id is not in the
   * palette. AIR always resolves to 0.
   */
  getIndex(id: BlockId): number {
    const v = this.index.get(id);
    return v === undefined ? -1 : v;
  }

  /**
   * Get the BlockId for a palette index. Index 0 is always AIR.
   * Returns AIR for out-of-range indices (defensive).
   */
  getId(index: number): BlockId {
    const v = this.ids[index];
    return v === undefined ? AIR : v;
  }

  /** Number of distinct block ids in the palette (including AIR). */
  get size(): number {
    return this.ids.length;
  }
}
