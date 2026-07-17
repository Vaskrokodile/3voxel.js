import { describe, it, expect } from 'vitest';
import { SparseOctree } from '../SparseOctree.js';
import { AIR } from '../../core/types.js';

describe('SparseOctree', () => {
  it('starts empty', () => {
    const t = new SparseOctree(64, { x: 0, y: 0, z: 0 });
    expect(t.size).toBe(64);
    expect(t.solidCount).toBe(0);
    expect(t.getBlock(0, 0, 0)).toBe(AIR);
    expect(t.memoryBytes).toBe(0);
  });

  it('rejects non-power-of-two sizes', () => {
    expect(() => new SparseOctree(3, { x: 0, y: 0, z: 0 })).toThrow();
    expect(() => new SparseOctree(1, { x: 0, y: 0, z: 0 })).toThrow();
  });

  it('set/get round-trips a single voxel at depth', () => {
    const t = new SparseOctree(64, { x: 0, y: 0, z: 0 });
    t.setBlock(33, 17, 5, 9);
    expect(t.getBlock(33, 17, 5)).toBe(9);
    expect(t.solidCount).toBe(1);
    // Neighbors remain air.
    expect(t.getBlock(34, 17, 5)).toBe(AIR);
    expect(t.getBlock(33, 18, 5)).toBe(AIR);
  });

  it('is sparse: a single voxel uses far less memory than a full array', () => {
    const t = new SparseOctree(64, { x: 0, y: 0, z: 0 });
    t.setBlock(33, 17, 5, 9);
    // A full 64³ Uint8Array would be 262144 bytes. Sparse must be tiny.
    expect(t.memoryBytes).toBeLessThan(2048);
    expect(t.memoryBytes).toBeGreaterThan(0);
  });

  it('clearing a voxel collapses the tree back to empty', () => {
    const t = new SparseOctree(64, { x: 0, y: 0, z: 0 });
    t.setBlock(33, 17, 5, 9);
    expect(t.solidCount).toBe(1);
    expect(t.memoryBytes).toBeGreaterThan(0);
    t.setBlock(33, 17, 5, AIR);
    expect(t.solidCount).toBe(0);
    expect(t.memoryBytes).toBe(0);
    expect(t.getBlock(33, 17, 5)).toBe(AIR);
  });

  it('forEachSolid visits every non-air voxel with correct coords', () => {
    const t = new SparseOctree(64, { x: 0, y: 0, z: 0 });
    const placed: Array<[number, number, number, number]> = [
      [33, 17, 5, 9],
      [0, 0, 0, 1],
      [63, 63, 63, 2],
      [31, 31, 31, 3],
    ];
    for (const [x, y, z, id] of placed) {
      t.setBlock(x, y, z, id);
    }
    const seen: Array<[number, number, number, number]> = [];
    t.forEachSolid((lx, ly, lz, id) => {
      seen.push([lx, ly, lz, id]);
    });
    expect(seen.length).toBe(placed.length);
    for (const p of placed) {
      expect(seen).toContainEqual(p);
    }
  });

  it('forEachSolid on empty tree is a no-op', () => {
    const t = new SparseOctree(64, { x: 0, y: 0, z: 0 });
    let count = 0;
    t.forEachSolid(() => count++);
    expect(count).toBe(0);
  });

  it('works at size 2 (single leaf root)', () => {
    const t = new SparseOctree(2, { x: 0, y: 0, z: 0 });
    t.setBlock(0, 0, 0, 4);
    t.setBlock(1, 1, 1, 5);
    expect(t.getBlock(0, 0, 0)).toBe(4);
    expect(t.getBlock(1, 1, 1)).toBe(5);
    expect(t.getBlock(0, 1, 0)).toBe(AIR);
    expect(t.solidCount).toBe(2);
    t.setBlock(0, 0, 0, AIR);
    t.setBlock(1, 1, 1, AIR);
    expect(t.solidCount).toBe(0);
    expect(t.memoryBytes).toBe(0);
  });

  it('out-of-range access is safe', () => {
    const t = new SparseOctree(64, { x: 0, y: 0, z: 0 });
    t.setBlock(0, 0, 0, 1);
    expect(t.getBlock(-1, 0, 0)).toBe(AIR);
    expect(t.getBlock(64, 0, 0)).toBe(AIR);
    t.setBlock(-1, 0, 0, 1); // ignored
    t.setBlock(64, 0, 0, 1); // ignored
    expect(t.solidCount).toBe(1);
  });

  it('dense fill produces correct solidCount and forEachSolid count', () => {
    const t = new SparseOctree(8, { x: 0, y: 0, z: 0 });
    for (let y = 0; y < 8; y++) {
      for (let z = 0; z < 8; z++) {
        for (let x = 0; x < 8; x++) {
          t.setBlock(x, y, z, 7);
        }
      }
    }
    expect(t.solidCount).toBe(512);
    let count = 0;
    t.forEachSolid(() => count++);
    expect(count).toBe(512);
  });
});
