import { describe, it, expect } from 'vitest';
import { BigChunkSerializer } from '../BigChunkSerializer.js';
import { Chunk32, Chunk64 } from '../BigChunk.js';
import { AIR } from '../../core/types.js';

describe('BigChunkSerializer', () => {
  it('serializes a Chunk32 with a local palette', () => {
    const c = new Chunk32({ x: 0, y: 0, z: 0 });
    // Fill with two block ids in a known pattern.
    c.fill((lx, ly, lz) => ((lx + lz) % 2 === 0 ? 7 : 3));
    const s = new BigChunkSerializer();
    const out = s.serialize(c);
    expect(out.size).toBe(32);
    expect(out.blocks.length).toBe(32 * 32 * 32);
    expect(out.subChunks).toBe(8);
    // Palette has AIR + 7 + 3.
    expect(out.paletteIds.length).toBe(3);
    expect(out.paletteIds[0]).toBe(AIR);
    expect(out.paletteIds).toContain(7);
    expect(out.paletteIds).toContain(3);
    // Reconstruct a block from the serialized form and verify.
    const idxAt = (lx: number, ly: number, lz: number): number =>
      out.blocks[lx + lz * 32 + ly * 32 * 32] as number;
    const idAt = (lx: number, ly: number, lz: number): number =>
      out.paletteIds[idxAt(lx, ly, lz)] as number;
    expect(idAt(0, 0, 0)).toBe(7);
    expect(idAt(1, 0, 0)).toBe(3);
    expect(idAt(2, 0, 0)).toBe(7);
  });

  it('serializeSubChunk returns a 16³ region matching the chunk', () => {
    const c = new Chunk32({ x: 0, y: 0, z: 0 });
    // Put id 5 in sub-chunk (1,1,1) and id 9 elsewhere.
    c.fill((lx, ly, lz) => {
      if (lx >= 16 && ly >= 16 && lz >= 16) return 5;
      return 9;
    });
    const s = new BigChunkSerializer();
    const sub = s.serializeSubChunk(c, 1, 1, 1);
    expect(sub.size).toBe(16);
    expect(sub.blocks.length).toBe(16 * 16 * 16);
    expect(sub.subChunks).toBe(1);
    // All voxels in this sub-chunk are id 5.
    expect(sub.paletteIds).toContain(5);
    for (let i = 0; i < sub.blocks.length; i++) {
      const id = sub.paletteIds[sub.blocks[i] as number] as number;
      expect(id).toBe(5);
    }

    // A different sub-chunk should be id 9.
    const sub0 = s.serializeSubChunk(c, 0, 0, 0);
    for (let i = 0; i < sub0.blocks.length; i++) {
      const id = sub0.paletteIds[sub0.blocks[i] as number] as number;
      expect(id).toBe(9);
    }
  });

  it('serializeSubChunk out of range throws', () => {
    const c = new Chunk32({ x: 0, y: 0, z: 0 });
    const s = new BigChunkSerializer();
    expect(() => s.serializeSubChunk(c, 2, 0, 0)).toThrow(RangeError);
  });

  it('serializes a Chunk64', () => {
    const c = new Chunk64({ x: 0, y: 0, z: 0 });
    c.setBlock(0, 0, 0, 1);
    c.setBlock(63, 63, 63, 2);
    const s = new BigChunkSerializer();
    const out = s.serialize(c);
    expect(out.size).toBe(64);
    expect(out.blocks.length).toBe(64 * 64 * 64);
    expect(out.subChunks).toBe(64);
    expect(out.paletteIds.length).toBe(3); // AIR + 1 + 2
    const idAt = (lx: number, ly: number, lz: number): number =>
      out.paletteIds[out.blocks[lx + lz * 64 + ly * 64 * 64] as number] as number;
    expect(idAt(0, 0, 0)).toBe(1);
    expect(idAt(63, 63, 63)).toBe(2);
    expect(idAt(1, 1, 1)).toBe(AIR);
  });

  it('serializeSubChunk of a Chunk64 covers the right 16³ region', () => {
    const c = new Chunk64({ x: 0, y: 0, z: 0 });
    // Sub-chunk (3,0,0) starts at world-local (48,0,0).
    c.fill((lx, ly, lz) => (lx >= 48 ? 11 : AIR));
    const s = new BigChunkSerializer();
    const sub = s.serializeSubChunk(c, 3, 0, 0);
    expect(sub.size).toBe(16);
    for (let i = 0; i < sub.blocks.length; i++) {
      const id = sub.paletteIds[sub.blocks[i] as number] as number;
      expect(id).toBe(11);
    }
  });
});
