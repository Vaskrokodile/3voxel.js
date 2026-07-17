import { describe, it, expect } from 'vitest';
import {
  quat,
  quatFromAxisAngle,
  quatNormalize,
  quatMultiply,
  quatToMat4,
  quatSlerp,
} from '../Quat.js';
import { mat4MultiplyVec3 } from '../Mat4.js';
import { mat4 } from '../Mat4.js';
import { vec3 } from '../Vec3.js';

describe('Quat', () => {
  it('identity is (0,0,0,1)', () => {
    expect(quat()).toEqual({ x: 0, y: 0, z: 0, w: 1 });
  });

  it('quatFromAxisAngle + quatToMat4 rotates a known vector (90deg about Y)', () => {
    const q = quat();
    quatFromAxisAngle(q, vec3(0, 1, 0), Math.PI / 2);
    const m = mat4();
    quatToMat4(m, q);
    const out = vec3();
    mat4MultiplyVec3(out, m, vec3(1, 0, 0));
    expect(out.x).toBeCloseTo(0, 6);
    expect(out.y).toBeCloseTo(0, 6);
    expect(out.z).toBeCloseTo(-1, 6);
  });

  it('quatToMat4 identity produces identity matrix', () => {
    const m = mat4();
    quatToMat4(m, quat());
    expect(m.m[0]).toBeCloseTo(1, 6);
    expect(m.m[5]).toBeCloseTo(1, 6);
    expect(m.m[10]).toBeCloseTo(1, 6);
    expect(m.m[15]).toBeCloseTo(1, 6);
    expect(m.m[1]).toBeCloseTo(0, 6);
  });

  it('quatNormalize of zero returns identity', () => {
    const out = quat();
    quatNormalize(out, quat(0, 0, 0, 0));
    expect(out).toEqual({ x: 0, y: 0, z: 0, w: 1 });
  });

  it('quatMultiply: identity * q == q', () => {
    const q = quat();
    quatFromAxisAngle(q, vec3(0, 1, 0), Math.PI / 4);
    const out = quat();
    quatMultiply(out, quat(), q);
    expect(out.x).toBeCloseTo(q.x, 6);
    expect(out.y).toBeCloseTo(q.y, 6);
    expect(out.z).toBeCloseTo(q.z, 6);
    expect(out.w).toBeCloseTo(q.w, 6);
  });

  it('quatSlerp endpoints', () => {
    const a = quat();
    quatFromAxisAngle(a, vec3(0, 1, 0), 0);
    const b = quat();
    quatFromAxisAngle(b, vec3(0, 1, 0), Math.PI / 2);
    const out = quat();
    quatSlerp(out, a, b, 0);
    expect(out.x).toBeCloseTo(a.x, 6);
    expect(out.w).toBeCloseTo(a.w, 6);
    quatSlerp(out, a, b, 1);
    expect(out.x).toBeCloseTo(b.x, 6);
    expect(out.w).toBeCloseTo(b.w, 6);
  });

  it('quatSlerp midpoint rotates half the angle', () => {
    const a = quat();
    quatFromAxisAngle(a, vec3(0, 1, 0), 0);
    const b = quat();
    quatFromAxisAngle(b, vec3(0, 1, 0), Math.PI / 2);
    const mid = quat();
    quatSlerp(mid, a, b, 0.5);
    const m = mat4();
    quatToMat4(m, mid);
    const out = vec3();
    mat4MultiplyVec3(out, m, vec3(1, 0, 0));
    // Half of 90deg about Y: (1,0,0) -> (cos45, 0, -sin45)
    expect(out.x).toBeCloseTo(Math.SQRT1_2, 6);
    expect(out.z).toBeCloseTo(-Math.SQRT1_2, 6);
  });
});
