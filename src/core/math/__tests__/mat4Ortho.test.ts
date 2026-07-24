import { describe, it, expect } from 'vitest';
import { mat4, mat4Ortho, mat4MultiplyVec3 } from '../Mat4.js';

describe('mat4Ortho', () => {
  it('maps the box corners to NDC z in [0,1] (WebGPU convention)', () => {
    const m = mat4();
    mat4Ortho(m, -1, 1, -1, 1, 0, 10);
    // Center maps to origin in xy, z=0 plane maps to 0, z=-far maps to 1.
    const c = { x: 0, y: 0, z: 0 };
    const near = { x: 0, y: 0, z: -0 };
    const far = { x: 0, y: 0, z: -10 };
    const out = { x: 0, y: 0, z: 0 };
    mat4MultiplyVec3(out, m, c);
    expect(out.x).toBeCloseTo(0);
    expect(out.y).toBeCloseTo(0);
    mat4MultiplyVec3(near, m, { x: 0, y: 0, z: 0 });
    expect(near.z).toBeCloseTo(0);
    mat4MultiplyVec3(far, m, { x: 0, y: 0, z: -10 });
    expect(far.z).toBeCloseTo(1);
  });

  it('scales x/y by 2/(right-left) and 2/(top-bottom)', () => {
    const m = mat4();
    mat4Ortho(m, -2, 2, -4, 4, 1, 100);
    expect(m.m[0]).toBeCloseTo(2 / 4); // 0.5
    expect(m.m[5]).toBeCloseTo(2 / 8); // 0.25
  });

  it('returns identity-like on degenerate volume (no NaNs)', () => {
    const m = mat4();
    mat4Ortho(m, 0, 0, -1, 1, 1, 100);
    expect(Number.isNaN(m.m[0])).toBe(false);
    expect(m.m[15]).toBe(1);
  });
});
