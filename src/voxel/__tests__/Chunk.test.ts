import { describe, it, expect } from 'vitest';
import { Chunk, localIndex } from '../Chunk.js';
import { AIR, CHUNK_SIZE, CHUNK_VOLUME } from '../../core/types.js';

describe('Chunk', () => {
  it('starts empty (all AIR, palette size 1, bytesPerVoxel 1)', () => {
    const c = new Chunk({ x: 0, y: 0, z: 0 });
    expect(c.isEmpty()).toBe(true);
    expect(c.palette.size).toBe(1);
    expect(c.bytesPerVoxel).toBe(1);
    expect(c.getBlock(0, 0, 0)).toBe(AIR);
  });

  it('fill + getBlock returns the filled id everywhere', () => {
    const c = new Chunk({ x: 0, y: 0, z: 0 });
    c.fill(7);
    expect(c.isEmpty()).toBe(false);
    expect(c.palette.size).toBe(2); // AIR + 7
    expect(c.bytesPerVoxel).toBe(1);
    for (let y = 0; y < CHUNK_SIZE; y++) {
      for (let z = 0; z < CHUNK_SIZE; z++) {
        for (let x = 0; x < CHUNK_SIZE; x++) {
          expect(c.getBlock(x, y, z)).toBe(7);
        }
      }
    }
  });

  it('setBlock across the 0..15 range round-trips', () => {
    const c = new Chunk({ x: 0, y: 0, z: 0 });
    // Set a distinct id at each voxel using a deterministic pattern.
    for (let y = 0; y < CHUNK_SIZE; y++) {
      for (let z = 0; z < CHUNK_SIZE; z++) {
        for (let x = 0; x < CHUNK_SIZE; x++) {
          const id = 1 + ((x + z * CHUNK_SIZE + y * CHUNK_SIZE * CHUNK_SIZE) % 10);
          c.setBlock(x, y, z, id);
        }
      }
    }
    for (let y = 0; y < CHUNK_SIZE; y++) {
      for (let z = 0; z < CHUNK_SIZE; z++) {
        for (let x = 0; x < CHUNK_SIZE; x++) {
          const expected = 1 + ((x + z * CHUNK_SIZE + y * CHUNK_SIZE * CHUNK_SIZE) % 10);
          expect(c.getBlock(x, y, z)).toBe(expected);
        }
      }
    }
  });

  it('local index formula: lx + lz*S + ly*S*S', () => {
    expect(localIndex(0, 0, 0)).toBe(0);
    expect(localIndex(1, 0, 0)).toBe(1);
    expect(localIndex(0, 0, 1)).toBe(CHUNK_SIZE);
    expect(localIndex(0, 1, 0)).toBe(CHUNK_SIZE * CHUNK_SIZE);
    expect(localIndex(15, 15, 15)).toBe(CHUNK_VOLUME - 1);
  });

  it('uniform chunk memory: bytesPerVoxel===1, palette size 1', () => {
    const c = new Chunk({ x: 0, y: 0, z: 0 });
    // All AIR -> palette size 1, index array 4096 bytes.
    expect(c.bytesPerVoxel).toBe(1);
    expect(c.palette.size).toBe(1);
    expect(c.getMemoryBytes()).toBeGreaterThanOrEqual(CHUNK_VOLUME);
  });

  it('migrates to Uint16 when palette exceeds 256 distinct ids', () => {
    const c = new Chunk({ x: 0, y: 0, z: 0 });
    // Place ids 1..255 at distinct voxels in the y=0 plane (palette size 256, Uint8).
    for (let id = 1; id <= 255; id++) {
      const lx = id % CHUNK_SIZE;
      const lz = Math.floor(id / CHUNK_SIZE) % CHUNK_SIZE;
      c.setBlock(lx, 0, lz, id);
    }
    expect(c.bytesPerVoxel).toBe(1);
    // 257th distinct id forces migration.
    c.setBlock(0, 1, 0, 256);
    expect(c.bytesPerVoxel).toBe(2);
    expect(c.palette.size).toBe(257);
    // Previous values survive migration.
    expect(c.getBlock(1, 0, 0)).toBe(1);
    expect(c.getBlock(0, 1, 0)).toBe(256);
  });

  it('out-of-range getBlock returns AIR', () => {
    const c = new Chunk({ x: 0, y: 0, z: 0 });
    c.fill(3);
    expect(c.getBlock(-1, 0, 0)).toBe(AIR);
    expect(c.getBlock(0, 16, 0)).toBe(AIR);
    expect(c.getBlock(0, 0, 99)).toBe(AIR);
  });
});
