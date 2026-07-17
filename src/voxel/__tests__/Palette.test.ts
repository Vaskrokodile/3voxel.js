import { describe, it, expect } from 'vitest';
import { Palette } from '../Palette.js';
import { AIR } from '../../core/types.js';

describe('Palette', () => {
  it('starts with AIR at index 0', () => {
    const p = new Palette();
    expect(p.size).toBe(1);
    expect(p.getIndex(AIR)).toBe(0);
    expect(p.getId(0)).toBe(AIR);
  });

  it('add/get round-trips distinct ids', () => {
    const p = new Palette();
    const i1 = p.add(1);
    const i2 = p.add(2);
    expect(i1).toBe(1);
    expect(i2).toBe(2);
    expect(p.getIndex(1)).toBe(1);
    expect(p.getId(1)).toBe(1);
    expect(p.getIndex(2)).toBe(2);
    expect(p.getId(2)).toBe(2);
    expect(p.size).toBe(3);
  });

  it('add is idempotent for existing ids', () => {
    const p = new Palette();
    const a = p.add(5);
    const b = p.add(5);
    expect(a).toBe(b);
    expect(p.size).toBe(2);
  });

  it('getIndex returns -1 for unknown id', () => {
    const p = new Palette();
    expect(p.getIndex(999)).toBe(-1);
  });

  it('migrates to Uint16-capable indices at the 257th distinct block', () => {
    const p = new Palette();
    // AIR is index 0; add ids 1..255 -> indices 1..255, palette size 256, all fit in byte.
    for (let id = 1; id <= 255; id++) {
      p.add(id);
    }
    expect(p.size).toBe(256);
    expect(p.getIndex(255)).toBe(255);
    // 257th distinct block (id 256) -> index 256, which no longer fits in a byte.
    const idx = p.add(256);
    expect(idx).toBe(256);
    expect(p.size).toBe(257);
    expect(p.getIndex(256)).toBe(256);
    expect(p.getId(256)).toBe(256);
  });
});
