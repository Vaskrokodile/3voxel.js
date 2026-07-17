import { describe, it, expect } from 'vitest';
import { vec4, vec4Dot, vec4Length, vec4NormalizeInto } from '../Vec4.js';

describe('Vec4', () => {
  it('vec4 defaults to zero', () => {
    expect(vec4()).toEqual({ x: 0, y: 0, z: 0, w: 0 });
  });

  it('dot', () => {
    expect(vec4Dot(vec4(1, 2, 3, 4), vec4(5, 6, 7, 8))).toBe(70);
  });

  it('length', () => {
    expect(vec4Length(vec4(0, 0, 3, 4))).toBeCloseTo(5);
  });

  it('normalizeInto of zero returns zero', () => {
    const out = vec4();
    vec4NormalizeInto(out, vec4(0, 0, 0, 0));
    expect(out).toEqual({ x: 0, y: 0, z: 0, w: 0 });
  });

  it('normalizeInto', () => {
    const out = vec4();
    vec4NormalizeInto(out, vec4(0, 0, 0, 5));
    expect(out).toEqual({ x: 0, y: 0, z: 0, w: 1 });
  });
});
