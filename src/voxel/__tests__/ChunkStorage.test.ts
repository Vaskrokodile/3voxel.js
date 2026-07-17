import { describe, it, expect } from 'vitest';
import { ChunkStorage } from '../ChunkStorage.js';
import { Chunk } from '../Chunk.js';

describe('ChunkStorage', () => {
  it('set/get/has/delete', () => {
    const s = new ChunkStorage();
    const c = new Chunk({ x: 1, y: 2, z: 3 });
    expect(s.has({ x: 1, y: 2, z: 3 })).toBe(false);
    s.set({ x: 1, y: 2, z: 3 }, c);
    expect(s.has({ x: 1, y: 2, z: 3 })).toBe(true);
    expect(s.get({ x: 1, y: 2, z: 3 })).toBe(c);
    expect(s.size).toBe(1);
    s.delete({ x: 1, y: 2, z: 3 });
    expect(s.has({ x: 1, y: 2, z: 3 })).toBe(false);
    expect(s.get({ x: 1, y: 2, z: 3 })).toBeUndefined();
    expect(s.size).toBe(0);
  });

  it('iteration yields [key, chunk] pairs', () => {
    const s = new ChunkStorage();
    const a = new Chunk({ x: 0, y: 0, z: 0 });
    const b = new Chunk({ x: 1, y: 0, z: 0 });
    s.set({ x: 0, y: 0, z: 0 }, a);
    s.set({ x: 1, y: 0, z: 0 }, b);
    const seen = new Map<string, Chunk>();
    for (const [key, chunk] of s) {
      seen.set(key, chunk);
    }
    expect(seen.size).toBe(2);
    expect(seen.get('0,0,0')).toBe(a);
    expect(seen.get('1,0,0')).toBe(b);
  });

  it('forEach visits every chunk', () => {
    const s = new ChunkStorage();
    s.set({ x: 0, y: 0, z: 0 }, new Chunk({ x: 0, y: 0, z: 0 }));
    s.set({ x: -1, y: 0, z: 0 }, new Chunk({ x: -1, y: 0, z: 0 }));
    let count = 0;
    s.forEach(() => count++);
    expect(count).toBe(2);
  });

  it('getMemoryBytes sums chunk memory', () => {
    const s = new ChunkStorage();
    s.set({ x: 0, y: 0, z: 0 }, new Chunk({ x: 0, y: 0, z: 0 }));
    expect(s.getMemoryBytes()).toBeGreaterThan(0);
  });
});
