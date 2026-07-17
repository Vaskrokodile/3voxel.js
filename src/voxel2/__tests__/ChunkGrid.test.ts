import { describe, it, expect } from 'vitest';
import { ChunkGrid, type ChunkSize } from '../ChunkGrid.js';
import { Chunk32, Chunk64 } from '../BigChunk.js';
import { Chunk } from '../../voxel/Chunk.js';

// ChunkGrid stores BigChunkLike entries; for size-16 tests we need a
// BigChunkLike adapter around the existing 16³ Chunk.
class Chunk16Adapter {
  readonly size = 16;
  readonly coord: { x: number; y: number; z: number };
  private readonly inner: Chunk;
  constructor(coord: { x: number; y: number; z: number }) {
    this.coord = coord;
    this.inner = new Chunk(coord);
  }
  getBlock(lx: number, ly: number, lz: number): number {
    return this.inner.getBlock(lx, ly, lz);
  }
  setBlock(lx: number, ly: number, lz: number, id: number): void {
    this.inner.setBlock(lx, ly, lz, id);
  }
  getSubChunk(): never {
    throw new Error('not used');
  }
  fill(generator: (lx: number, ly: number, lz: number) => number): void {
    for (let ly = 0; ly < 16; ly++) {
      for (let lz = 0; lz < 16; lz++) {
        for (let lx = 0; lx < 16; lx++) {
          this.inner.setBlock(lx, ly, lz, generator(lx, ly, lz));
        }
      }
    }
  }
  get solidCount(): number {
    let n = 0;
    for (let ly = 0; ly < 16; ly++) {
      for (let lz = 0; lz < 16; lz++) {
        for (let lx = 0; lx < 16; lx++) {
          if (this.inner.getBlock(lx, ly, lz) !== 0) n++;
        }
      }
    }
    return n;
  }
  get isEmpty(): boolean {
    return this.inner.isEmpty();
  }
}

describe('ChunkGrid', () => {
  it('set/get/delete', () => {
    const g = new ChunkGrid();
    const coord = { x: 1, y: 0, z: 0 };
    const chunk = new Chunk32(coord);
    g.set(coord, 32, chunk);
    expect(g.size).toBe(1);
    const entry = g.get(coord);
    expect(entry).not.toBeNull();
    expect(entry!.size).toBe(32);
    expect(entry!.lod).toBe(1);
    expect(entry!.chunk).toBe(chunk);
    g.delete(coord);
    expect(g.get(coord)).toBeNull();
    expect(g.size).toBe(0);
  });

  it('queryRange returns intersecting chunks', () => {
    const g = new ChunkGrid();
    const c32 = new Chunk32({ x: 0, y: 0, z: 0 }); // world [0,32)
    const c64 = new Chunk64({ x: 1, y: 0, z: 0 }); // world [64,128)
    g.set({ x: 0, y: 0, z: 0 }, 32, c32);
    g.set({ x: 1, y: 0, z: 0 }, 64, c64);
    // Query [10,70]: intersects the 32 chunk [0,32) and the 64 chunk [64,128).
    const res = g.queryRange({ x: 10, y: 0, z: 0 }, { x: 70, y: 32, z: 32 });
    expect(res.length).toBe(2);
    // Query far away: no hits.
    const res2 = g.queryRange({ x: 1000, y: 1000, z: 1000 }, { x: 1010, y: 1010, z: 1010 });
    expect(res2.length).toBe(0);
  });

  it('optimalSize by distance', () => {
    expect(ChunkGrid.optimalSize(0)).toBe(16);
    expect(ChunkGrid.optimalSize(63)).toBe(16);
    expect(ChunkGrid.optimalSize(64)).toBe(32);
    expect(ChunkGrid.optimalSize(127)).toBe(32);
    expect(ChunkGrid.optimalSize(128)).toBe(64);
    expect(ChunkGrid.optimalSize(1000)).toBe(64);
  });

  it('worldToChunk / chunkToWorld round-trip (positive)', () => {
    const size: ChunkSize = 32;
    const coord = ChunkGrid.worldToChunk(40, 5, 33, size);
    expect(coord).toEqual({ x: 1, y: 0, z: 1 });
    const w = ChunkGrid.chunkToWorld(coord, size);
    expect(w).toEqual({ x: 32, y: 0, z: 32 });
  });

  it('worldToChunk handles negatives with floor', () => {
    const coord = ChunkGrid.worldToChunk(-1, -1, -1, 16);
    expect(coord).toEqual({ x: -1, y: -1, z: -1 });
    const w = ChunkGrid.chunkToWorld(coord, 16);
    expect(w).toEqual({ x: -16, y: -16, z: -16 });
  });

  it('lod is assigned from size', () => {
    const g = new ChunkGrid();
    const a = new Chunk16Adapter({ x: 0, y: 0, z: 0 });
    const b = new Chunk32({ x: 0, y: 0, z: 0 });
    const c = new Chunk64({ x: 0, y: 0, z: 0 });
    g.set({ x: 0, y: 0, z: 0 }, 16, a);
    g.set({ x: 1, y: 0, z: 0 }, 32, b);
    g.set({ x: 2, y: 0, z: 0 }, 64, c);
    expect(g.get({ x: 0, y: 0, z: 0 })!.lod).toBe(0);
    expect(g.get({ x: 1, y: 0, z: 0 })!.lod).toBe(1);
    expect(g.get({ x: 2, y: 0, z: 0 })!.lod).toBe(2);
  });

  it('clear removes all entries', () => {
    const g = new ChunkGrid();
    g.set({ x: 0, y: 0, z: 0 }, 32, new Chunk32({ x: 0, y: 0, z: 0 }));
    g.set({ x: 1, y: 0, z: 0 }, 64, new Chunk64({ x: 1, y: 0, z: 0 }));
    expect(g.size).toBe(2);
    g.clear();
    expect(g.size).toBe(0);
  });
});
