import { describe, it, expect } from 'vitest';
import {
  vec3,
  vec3Add,
  vec3Sub,
  vec3Scale,
  vec3Dot,
  vec3Cross,
  vec3Length,
  vec3Normalize,
  vec3Negate,
  vec3Lerp,
  vec3Distance,
  vec3Min,
  vec3Max,
  vec3Equals,
  vec3NormalizeInto,
  Vec3Pool,
} from '../Vec3.js';

describe('Vec3', () => {
  it('vec3 defaults to zero', () => {
    const v = vec3();
    expect(v).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('add / sub / scale', () => {
    expect(vec3Add(vec3(1, 2, 3), vec3(4, 5, 6))).toEqual({ x: 5, y: 7, z: 9 });
    expect(vec3Sub(vec3(4, 5, 6), vec3(1, 2, 3))).toEqual({ x: 3, y: 3, z: 3 });
    expect(vec3Scale(vec3(1, 2, 3), 2)).toEqual({ x: 2, y: 4, z: 6 });
  });

  it('dot product', () => {
    expect(vec3Dot(vec3(1, 0, 0), vec3(1, 0, 0))).toBe(1);
    expect(vec3Dot(vec3(1, 0, 0), vec3(0, 1, 0))).toBe(0);
    expect(vec3Dot(vec3(1, 2, 3), vec3(4, 5, 6))).toBe(32);
  });

  it('cross product (right-handed)', () => {
    expect(vec3Cross(vec3(1, 0, 0), vec3(0, 1, 0))).toEqual({ x: 0, y: 0, z: 1 });
    expect(vec3Cross(vec3(0, 1, 0), vec3(1, 0, 0))).toEqual({ x: 0, y: 0, z: -1 });
  });

  it('length', () => {
    expect(vec3Length(vec3(0, 0, 0))).toBe(0);
    expect(vec3Length(vec3(3, 4, 0))).toBeCloseTo(5);
  });

  it('normalize', () => {
    const n = vec3Normalize(vec3(0, 5, 0));
    expect(n).toEqual({ x: 0, y: 1, z: 0 });
    expect(vec3Length(n)).toBeCloseTo(1);
  });

  it('normalize of zero-length returns zero (not NaN)', () => {
    const n = vec3Normalize(vec3(0, 0, 0));
    expect(n).toEqual({ x: 0, y: 0, z: 0 });
    expect(Number.isNaN(n.x)).toBe(false);
  });

  it('normalizeInto does not allocate', () => {
    const out = vec3();
    const ref = vec3NormalizeInto(out, vec3(0, 0, 3));
    expect(ref).toBe(out);
    expect(out).toEqual({ x: 0, y: 0, z: 1 });
  });

  it('negate', () => {
    expect(vec3Negate(vec3(1, -2, 3))).toEqual({ x: -1, y: 2, z: -3 });
  });

  it('lerp', () => {
    expect(vec3Lerp(vec3(0, 0, 0), vec3(10, 20, 30), 0.5)).toEqual({ x: 5, y: 10, z: 15 });
  });

  it('distance', () => {
    expect(vec3Distance(vec3(0, 0, 0), vec3(3, 4, 0))).toBeCloseTo(5);
  });

  it('min / max', () => {
    expect(vec3Min(vec3(1, 5, 3), vec3(4, 2, 6))).toEqual({ x: 1, y: 2, z: 3 });
    expect(vec3Max(vec3(1, 5, 3), vec3(4, 2, 6))).toEqual({ x: 4, y: 5, z: 6 });
  });

  it('equals', () => {
    expect(vec3Equals(vec3(1, 2, 3), vec3(1, 2, 3))).toBe(true);
    expect(vec3Equals(vec3(1, 2, 3), vec3(1, 2, 4))).toBe(false);
  });

  it('Vec3Pool acquire/release reuses objects', () => {
    const pool = new Vec3Pool();
    const a = pool.acquire();
    a.x = 9;
    pool.release(a);
    const b = pool.acquire();
    expect(b).toBe(a);
    expect(b).toEqual({ x: 0, y: 0, z: 0 });
  });
});
