import { describe, it, expect } from 'vitest';
import {
  mat4,
  mat4Identity,
  mat4Multiply,
  mat4Perspective,
  mat4LookAt,
  mat4Translation,
  mat4RotationY,
  mat4Invert,
  mat4MultiplyVec3,
  mat4MultiplyVec4,
} from '../Mat4.js';
import { vec3 } from '../Vec3.js';
import { vec4 } from '../Vec4.js';

describe('Mat4', () => {
  it('mat4() creates identity', () => {
    const m = mat4();
    expect(m.m.length).toBe(16);
    expect(Array.from(m.m)).toEqual([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ]);
  });

  it('mat4Identity resets to identity', () => {
    const m = mat4();
    m.m.fill(99);
    mat4Identity(m);
    expect(m.m[0]).toBe(1);
    expect(m.m[5]).toBe(1);
    expect(m.m[10]).toBe(1);
    expect(m.m[15]).toBe(1);
    expect(m.m[1]).toBe(0);
  });

  it('mat4Multiply: A * I == A', () => {
    const a = mat4();
    mat4Translation(a, vec3(1, 2, 3));
    const out = mat4();
    mat4Multiply(out, a, mat4());
    expect(out.m[12]).toBe(1);
    expect(out.m[13]).toBe(2);
    expect(out.m[14]).toBe(3);
  });

  it('mat4Perspective maps near plane to NDC z=0 and far to z=1 (WebGPU)', () => {
    const near = 1;
    const far = 100;
    const p = mat4();
    mat4Perspective(p, Math.PI / 2, 1, near, far);

    // Point on the near plane, straight ahead (eye-space -Z).
    const nearClip = vec4(0, 0, -near, 1);
    const nearOut = vec4();
    mat4MultiplyVec4(nearOut, p, nearClip);
    const nearNdcZ = nearOut.z / nearOut.w;
    expect(nearNdcZ).toBeCloseTo(0, 6);

    // Point on the far plane.
    const farClip = vec4(0, 0, -far, 1);
    const farOut = vec4();
    mat4MultiplyVec4(farOut, p, farClip);
    const farNdcZ = farOut.z / farOut.w;
    expect(farNdcZ).toBeCloseTo(1, 6);
  });

  it('mat4Perspective is not the OpenGL [-1,1] form', () => {
    const p = mat4();
    mat4Perspective(p, Math.PI / 2, 1, 1, 100);
    // WebGPU form: m[10] = far/(near-far), m[14] = near*far/(near-far)
    expect(p.m[10]).toBeCloseTo(100 / (1 - 100), 6);
    expect(p.m[14]).toBeCloseTo((1 * 100) / (1 - 100), 6);
    expect(p.m[11]).toBe(-1);
  });

  it('mat4LookAt: eye maps to origin, forward maps to -Z', () => {
    const view = mat4();
    mat4LookAt(view, vec3(0, 0, 5), vec3(0, 0, 0), vec3(0, 1, 0));

    // Eye -> origin.
    const eyeView = vec3();
    mat4MultiplyVec3(eyeView, view, vec3(0, 0, 5));
    expect(eyeView.x).toBeCloseTo(0, 6);
    expect(eyeView.y).toBeCloseTo(0, 6);
    expect(eyeView.z).toBeCloseTo(0, 6);

    // Target (in front of eye) -> negative Z in view space.
    const targetView = vec3();
    mat4MultiplyVec3(targetView, view, vec3(0, 0, 0));
    expect(targetView.z).toBeLessThan(0);
    expect(targetView.z).toBeCloseTo(-5, 6);
  });

  it('mat4RotationY rotates (1,0,0) to (0,0,-1) at 90deg', () => {
    const r = mat4();
    mat4RotationY(r, Math.PI / 2);
    const out = vec3();
    mat4MultiplyVec3(out, r, vec3(1, 0, 0));
    expect(out.x).toBeCloseTo(0, 6);
    expect(out.y).toBeCloseTo(0, 6);
    expect(out.z).toBeCloseTo(-1, 6);
  });

  it('mat4Invert round-trips a translation', () => {
    const t = mat4();
    mat4Translation(t, vec3(3, 4, 5));
    const inv = mat4();
    mat4Invert(inv, t);
    const out = vec3();
    // Inverse translation should move (3,4,5) back to origin.
    mat4MultiplyVec3(out, inv, vec3(3, 4, 5));
    expect(out.x).toBeCloseTo(0, 6);
    expect(out.y).toBeCloseTo(0, 6);
    expect(out.z).toBeCloseTo(0, 6);
  });

  it('mat4Invert of singular matrix returns identity', () => {
    const s = mat4();
    s.m.fill(0); // all-zero is singular
    const inv = mat4();
    mat4Invert(inv, s);
    expect(inv.m[0]).toBe(1);
    expect(inv.m[5]).toBe(1);
    expect(inv.m[10]).toBe(1);
    expect(inv.m[15]).toBe(1);
  });
});
