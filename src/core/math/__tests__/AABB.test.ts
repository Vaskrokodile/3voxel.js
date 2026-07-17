import { describe, it, expect } from 'vitest';
import {
  aabb,
  aabbFromPoints,
  aabbCenter,
  aabbSize,
  aabbContainsPoint,
  aabbIntersectsAabb,
  aabbExpand,
  aabbTransform,
} from '../AABB.js';
import { mat4Translation, mat4Scale } from '../Mat4.js';
import { mat4 } from '../Mat4.js';
import { vec3 } from '../Vec3.js';

describe('AABB', () => {
  it('aabb copies corners', () => {
    const box = aabb(vec3(1, 2, 3), vec3(4, 5, 6));
    expect(box.min).toEqual({ x: 1, y: 2, z: 3 });
    expect(box.max).toEqual({ x: 4, y: 5, z: 6 });
  });

  it('aabbFromPoints encloses all points', () => {
    const box = aabbFromPoints([
      vec3(1, 5, 2), vec3(-3, 0, 8), vec3(2, 2, -1),
    ]);
    expect(box.min).toEqual({ x: -3, y: 0, z: -1 });
    expect(box.max).toEqual({ x: 2, y: 5, z: 8 });
  });

  it('aabbFromPoints empty yields zero box at origin', () => {
    const box = aabbFromPoints([]);
    expect(box.min).toEqual({ x: 0, y: 0, z: 0 });
    expect(box.max).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('aabbCenter / aabbSize', () => {
    const box = aabb(vec3(0, 0, 0), vec3(10, 20, 30));
    expect(aabbCenter(box)).toEqual({ x: 5, y: 10, z: 15 });
    expect(aabbSize(box)).toEqual({ x: 10, y: 20, z: 30 });
  });

  it('aabbContainsPoint inclusive', () => {
    const box = aabb(vec3(0, 0, 0), vec3(10, 10, 10));
    expect(aabbContainsPoint(box, vec3(5, 5, 5))).toBe(true);
    expect(aabbContainsPoint(box, vec3(0, 0, 0))).toBe(true);
    expect(aabbContainsPoint(box, vec3(10, 10, 10))).toBe(true);
    expect(aabbContainsPoint(box, vec3(11, 5, 5))).toBe(false);
  });

  it('aabbIntersectsAabb', () => {
    const a = aabb(vec3(0, 0, 0), vec3(10, 10, 10));
    expect(aabbIntersectsAabb(a, aabb(vec3(5, 5, 5), vec3(15, 15, 15)))).toBe(true);
    expect(aabbIntersectsAabb(a, aabb(vec3(11, 0, 0), vec3(20, 10, 10)))).toBe(false);
    // Touching counts as intersecting.
    expect(aabbIntersectsAabb(a, aabb(vec3(10, 0, 0), vec3(20, 10, 10)))).toBe(true);
  });

  it('aabbExpand grows on all sides', () => {
    const box = aabbExpand(aabb(vec3(0, 0, 0), vec3(10, 10, 10)), 2);
    expect(box.min).toEqual({ x: -2, y: -2, z: -2 });
    expect(box.max).toEqual({ x: 12, y: 12, z: 12 });
  });

  it('aabbTransform by translation moves the box', () => {
    const out = aabb(vec3(0, 0, 0), vec3(0, 0, 0));
    const box = aabb(vec3(0, 0, 0), vec3(2, 2, 2));
    const t = mat4();
    mat4Translation(t, vec3(10, 20, 30));
    aabbTransform(out, box, t);
    expect(out.min).toEqual({ x: 10, y: 20, z: 30 });
    expect(out.max).toEqual({ x: 12, y: 22, z: 32 });
  });

  it('aabbTransform by scale grows the box', () => {
    const out = aabb(vec3(0, 0, 0), vec3(0, 0, 0));
    const box = aabb(vec3(-1, -1, -1), vec3(1, 1, 1));
    const s = mat4();
    mat4Scale(s, vec3(2, 3, 4));
    aabbTransform(out, box, s);
    expect(out.min).toEqual({ x: -2, y: -3, z: -4 });
    expect(out.max).toEqual({ x: 2, y: 3, z: 4 });
  });
});
