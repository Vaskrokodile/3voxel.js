import { describe, it, expect } from 'vitest';
import {
  Chunk32,
  Chunk64,
  bigLocalIndex,
  CHUNK_SIZE_32,
  CHUNK_SIZE_64,
} from '../BigChunk.js';
import { AIR } from '../../core/types.js';

function runBigChunkTests(
  name: string,
  ChunkCtor: new (coord: { x: number; y: number; z: number }) => Chunk32 | Chunk64,
  size: number,
): void {
  describe(name, () => {
    it('starts empty (all AIR)', () => {
      const c = new ChunkCtor({ x: 0, y: 0, z: 0 });
      expect(c.size).toBe(size);
      expect(c.isEmpty).toBe(true);
      expect(c.solidCount).toBe(0);
      expect(c.getBlock(0, 0, 0)).toBe(AIR);
    });

    it('index formula: lx + lz*size + ly*size*size', () => {
      expect(bigLocalIndex(0, 0, 0, size)).toBe(0);
      expect(bigLocalIndex(1, 0, 0, size)).toBe(1);
      expect(bigLocalIndex(0, 0, 1, size)).toBe(size);
      expect(bigLocalIndex(0, 1, 0, size)).toBe(size * size);
      expect(bigLocalIndex(size - 1, size - 1, size - 1, size)).toBe(
        size * size * size - 1,
      );
    });

    it('setBlock/getBlock round-trips across the volume', () => {
      const c = new ChunkCtor({ x: 0, y: 0, z: 0 });
      for (let ly = 0; ly < size; ly++) {
        for (let lz = 0; lz < size; lz++) {
          for (let lx = 0; lx < size; lx++) {
            const id = 1 + ((lx + lz * size + ly * size * size) % 10);
            c.setBlock(lx, ly, lz, id);
          }
        }
      }
      expect(c.isEmpty).toBe(false);
      expect(c.solidCount).toBe(size * size * size);
      for (let ly = 0; ly < size; ly++) {
        for (let lz = 0; lz < size; lz++) {
          for (let lx = 0; lx < size; lx++) {
            const expected = 1 + ((lx + lz * size + ly * size * size) % 10);
            expect(c.getBlock(lx, ly, lz)).toBe(expected);
          }
        }
      }
    });

    it('solidCount tracks non-air voxels (set then clear)', () => {
      const c = new ChunkCtor({ x: 0, y: 0, z: 0 });
      c.setBlock(0, 0, 0, 5);
      c.setBlock(1, 0, 0, 5);
      expect(c.solidCount).toBe(2);
      c.setBlock(0, 0, 0, AIR);
      expect(c.solidCount).toBe(1);
      c.setBlock(1, 0, 0, AIR);
      expect(c.solidCount).toBe(0);
      expect(c.isEmpty).toBe(true);
    });

    it('out-of-range getBlock returns AIR', () => {
      const c = new ChunkCtor({ x: 0, y: 0, z: 0 });
      c.setBlock(0, 0, 0, 3);
      expect(c.getBlock(-1, 0, 0)).toBe(AIR);
      expect(c.getBlock(0, size, 0)).toBe(AIR);
      expect(c.getBlock(0, 0, size)).toBe(AIR);
    });

    it('out-of-range setBlock is ignored', () => {
      const c = new ChunkCtor({ x: 0, y: 0, z: 0 });
      c.setBlock(-1, 0, 0, 3);
      c.setBlock(0, size, 0, 3);
      expect(c.solidCount).toBe(0);
      expect(c.isEmpty).toBe(true);
    });

    it('fill applies the generator to every voxel', () => {
      const c = new ChunkCtor({ x: 0, y: 0, z: 0 });
      c.fill((lx, ly, lz) => (ly === 0 ? 7 : AIR));
      expect(c.solidCount).toBe(size * size);
      expect(c.isEmpty).toBe(false);
      for (let lz = 0; lz < size; lz++) {
        for (let lx = 0; lx < size; lx++) {
          expect(c.getBlock(lx, 0, lz)).toBe(7);
          expect(c.getBlock(lx, 1, lz)).toBe(AIR);
        }
      }
    });

    it('getSubChunk returns a 16³ view with correct origin and data', () => {
      const c = new ChunkCtor({ x: 0, y: 0, z: 0 });
      const subPerAxis = size / 16;
      // Place a distinct id in each sub-chunk's (0,0,0) voxel.
      let id = 1;
      for (let sy = 0; sy < subPerAxis; sy++) {
        for (let sz = 0; sz < subPerAxis; sz++) {
          for (let sx = 0; sx < subPerAxis; sx++) {
            c.setBlock(sx * 16, sy * 16, sz * 16, id);
            id++;
          }
        }
      }
      id = 1;
      for (let sy = 0; sy < subPerAxis; sy++) {
        for (let sz = 0; sz < subPerAxis; sz++) {
          for (let sx = 0; sx < subPerAxis; sx++) {
            const view = c.getSubChunk(sx, sy, sz);
            expect(view.originX).toBe(sx * 16);
            expect(view.originY).toBe(sy * 16);
            expect(view.originZ).toBe(sz * 16);
            expect(view.getBlock(0, 0, 0)).toBe(id);
            expect(view.getBlock(1, 0, 0)).toBe(AIR);
            id++;
          }
        }
      }
    });

    it('getSubChunk out of range throws', () => {
      const c = new ChunkCtor({ x: 0, y: 0, z: 0 });
      const subPerAxis = size / 16;
      expect(() => c.getSubChunk(subPerAxis, 0, 0)).toThrow(RangeError);
    });
  });
}

runBigChunkTests('Chunk32', Chunk32, CHUNK_SIZE_32);
runBigChunkTests('Chunk64', Chunk64, CHUNK_SIZE_64);
