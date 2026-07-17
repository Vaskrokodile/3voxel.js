import { describe, it, expect } from 'vitest';
import { ray, rayIntersectsAabb, rayAt } from '../Ray.js';
import { vec3 } from '../Vec3.js';
import { aabb } from '../AABB.js';

describe('Ray', () => {
  it('ray normalizes direction', () => {
    const r = ray(vec3(0, 0, 0), vec3(0, 0, 5));
    expect(r.dir).toEqual({ x: 0, y: 0, z: 1 });
  });

  it('ray with zero dir yields zero direction', () => {
    const r = ray(vec3(0, 0, 0), vec3(0, 0, 0));
    expect(r.dir).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('rayAt', () => {
    const r = ray(vec3(1, 2, 3), vec3(0, 0, 1));
    expect(rayAt(r, 5)).toEqual({ x: 1, y: 2, z: 8 });
  });

  it('rayIntersectsAabb hit from +X', () => {
    const r = ray(vec3(-10, 5, 5), vec3(1, 0, 0));
    const box = aabb(vec3(0, 0, 0), vec3(10, 10, 10));
    const t = rayIntersectsAabb(r, box);
    expect(t).not.toBeNull();
    expect(t).toBeCloseTo(10, 6);
  });

  it('rayIntersectsAabb miss (parallel, outside)', () => {
    const r = ray(vec3(-10, 50, 5), vec3(1, 0, 0));
    const box = aabb(vec3(0, 0, 0), vec3(10, 10, 10));
    expect(rayIntersectsAabb(r, box)).toBeNull();
  });

  it('rayIntersectsAabb miss (box behind ray)', () => {
    const r = ray(vec3(20, 5, 5), vec3(1, 0, 0));
    const box = aabb(vec3(0, 0, 0), vec3(10, 10, 10));
    expect(rayIntersectsAabb(r, box)).toBeNull();
  });

  it('rayIntersectsAabb origin inside box returns 0', () => {
    const r = ray(vec3(5, 5, 5), vec3(1, 0, 0));
    const box = aabb(vec3(0, 0, 0), vec3(10, 10, 10));
    expect(rayIntersectsAabb(r, box)).toBe(0);
  });
});
