import { describe, it, expect } from 'vitest';
import { SelectionHighlight } from '../SelectionHighlight.js';

describe('SelectionHighlight', () => {
  it('buildBox(0,0,0) produces 24 vertices and 24 indices', () => {
    const box = SelectionHighlight.buildBox(0, 0, 0);
    expect(box.vertices.length).toBe(24 * 3);
    expect(box.indices.length).toBe(24);
  });

  it('indices are sequential 0..23', () => {
    const box = SelectionHighlight.buildBox(0, 0, 0);
    for (let i = 0; i < 24; i++) {
      expect(box.indices[i]).toBe(i);
    }
  });

  it('box corners span approximately -0.0005 to 1.0005 on every axis', () => {
    const box = SelectionHighlight.buildBox(0, 0, 0);
    const v = box.vertices;
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < v.length; i += 3) {
      const x = v[i]!;
      const y = v[i + 1]!;
      const z = v[i + 2]!;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (z < minZ) minZ = z;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (z > maxZ) maxZ = z;
    }
    expect(minX).toBeCloseTo(-0.0005, 6);
    expect(minY).toBeCloseTo(-0.0005, 6);
    expect(minZ).toBeCloseTo(-0.0005, 6);
    expect(maxX).toBeCloseTo(1.0005, 6);
    expect(maxY).toBeCloseTo(1.0005, 6);
    expect(maxZ).toBeCloseTo(1.0005, 6);
  });

  it('buildBox offsets the box to the given world coordinate', () => {
    const box = SelectionHighlight.buildBox(10, 20, 30);
    const v = box.vertices;
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < v.length; i += 3) {
      const x = v[i]!;
      const y = v[i + 1]!;
      const z = v[i + 2]!;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (z < minZ) minZ = z;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (z > maxZ) maxZ = z;
    }
    expect(minX).toBeCloseTo(10 - 0.0005, 6);
    expect(minY).toBeCloseTo(20 - 0.0005, 6);
    expect(minZ).toBeCloseTo(30 - 0.0005, 6);
    expect(maxX).toBeCloseTo(11 + 0.0005, 6);
    expect(maxY).toBeCloseTo(21 + 0.0005, 6);
    expect(maxZ).toBeCloseTo(31 + 0.0005, 6);
  });

  it('produces 12 distinct line segments (24 endpoints)', () => {
    const box = SelectionHighlight.buildBox(0, 0, 0);
    // 24 vertices / 2 per line = 12 lines.
    expect(box.vertices.length / 6).toBe(12);
    expect(box.indices.length / 2).toBe(12);
  });
});
