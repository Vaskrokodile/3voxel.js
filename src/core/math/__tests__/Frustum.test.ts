import { describe, it, expect } from 'vitest';
import { Frustum, frustumFromViewProj, frustumIntersectsAabb } from '../Frustum.js';
import { mat4, mat4Perspective, mat4LookAt, mat4Multiply } from '../Mat4.js';
import { vec3 } from '../Vec3.js';
import { aabb } from '../AABB.js';
import type { Vec3 } from '../../types.js';

describe('Frustum', () => {
  function buildCameraFrustum(eye: Vec3, target: Vec3): Frustum {
    const proj = mat4();
    mat4Perspective(proj, Math.PI / 2, 1, 1, 100);
    const view = mat4();
    mat4LookAt(view, eye, target, vec3(0, 1, 0));
    const viewProj = mat4();
    mat4Multiply(viewProj, proj, view);
    const f = new Frustum();
    frustumFromViewProj(f, viewProj);
    return f;
  }

  it('culls a box behind the camera', () => {
    // Camera at origin looking down -Z; a box at +Z (behind) should be culled.
    const f = buildCameraFrustum(vec3(0, 0, 0), vec3(0, 0, -1));
    const behind = aabb(vec3(-5, -5, 20), vec3(5, 5, 30));
    expect(frustumIntersectsAabb(f, behind)).toBe(false);
  });

  it('keeps a box in front of the camera', () => {
    const f = buildCameraFrustum(vec3(0, 0, 0), vec3(0, 0, -1));
    const front = aabb(vec3(-5, -5, -50), vec3(5, 5, -40));
    expect(frustumIntersectsAabb(f, front)).toBe(true);
  });

  it('culls a box far to the side (outside the 90deg fov)', () => {
    const f = buildCameraFrustum(vec3(0, 0, 0), vec3(0, 0, -1));
    // With a 90deg fov, a box at z=-50 but x=200 is outside the right plane.
    const side = aabb(vec3(190, -5, -50), vec3(210, 5, -40));
    expect(frustumIntersectsAabb(f, side)).toBe(false);
  });

  it('near plane test: a box just past near is kept', () => {
    const f = buildCameraFrustum(vec3(0, 0, 0), vec3(0, 0, -1));
    const near = aabb(vec3(-2, -2, -10), vec3(2, 2, -2));
    expect(frustumIntersectsAabb(f, near)).toBe(true);
  });
});
