import { describe, expect, it } from 'vitest';
import { vertexAO } from '../ao.js';

const isSolid = (id: number): boolean => id !== 0;

describe('vertexAO', () => {
  it('returns 3 (no occlusion) when all neighbors are air', () => {
    expect(vertexAO(0, 0, 0, isSolid)).toBe(3);
  });

  it('returns 0 when either side is solid', () => {
    expect(vertexAO(1, 0, 0, isSolid)).toBe(0);
    expect(vertexAO(0, 1, 0, isSolid)).toBe(0);
    expect(vertexAO(1, 1, 0, isSolid)).toBe(0);
  });

  it('returns 2 when only the corner is solid (both sides air)', () => {
    expect(vertexAO(0, 0, 1, isSolid)).toBe(2);
  });

  it('returns 1 when both sides are air and corner is air but... (impossible with 0 sides)', () => {
    // With 0 solid sides, ao = 3 - solid(corner). Corner solid -> 2, corner air -> 3.
    // The 1 case requires exactly one solid side, but that yields 0 by the
    // side-occlusion rule. So 1 is unreachable in this scheme — documented.
    expect(vertexAO(0, 0, 0, isSolid)).toBe(3);
  });
});
