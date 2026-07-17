import { describe, it, expect } from 'vitest';
import type { Mat4, Vec3 } from '../../core/types.js';
import type { Mat4Ops } from '../types.js';
import { Camera } from '../Camera.js';
import { FlyController } from '../FlyController.js';
import type { FlyInput } from '../FlyController.js';

/**
 * Fake Mat4Ops that records every call and returns the `out` matrix filled
 * with a recognizable pattern so we can verify the camera wired the calls
 * correctly without depending on real math.
 */
class FakeMat4Ops implements Mat4Ops {
  readonly perspectiveCalls: {
    fovy: number;
    aspect: number;
    near: number;
    far: number;
  }[] = [];
  readonly lookAtCalls: { eye: Vec3; target: Vec3; up: Vec3 }[] = [];
  readonly multiplyCalls: { a: Mat4; b: Mat4 }[] = [];

  mat4(): Mat4 {
    return { m: new Float32Array(16) };
  }

  mat4Perspective(out: Mat4, fovy: number, aspect: number, near: number, far: number): Mat4 {
    this.perspectiveCalls.push({ fovy, aspect, near, far });
    // Tag the matrix so we can identify it.
    out.m[0] = 1;
    return out;
  }

  mat4LookAt(out: Mat4, eye: Vec3, target: Vec3, up: Vec3): Mat4 {
    this.lookAtCalls.push({
      eye: { ...eye },
      target: { ...target },
      up: { ...up },
    });
    out.m[0] = 2;
    return out;
  }

  mat4Multiply(out: Mat4, a: Mat4, b: Mat4): Mat4 {
    this.multiplyCalls.push({ a, b });
    out.m[0] = 3;
    return out;
  }
}

/** Approx-equality for a Vec3. */
function expectVec3Close(actual: Vec3, expected: Vec3, eps = 1e-6): void {
  expect(actual.x).toBeCloseTo(expected.x, 6);
  expect(actual.y).toBeCloseTo(expected.y, 6);
  expect(actual.z).toBeCloseTo(expected.z, 6);
}

describe('Camera', () => {
  it('forward is +X at yaw=0, pitch=0 (documented convention)', () => {
    const mat = new FakeMat4Ops();
    const cam = new Camera({ mat });
    // Convention: forward = (cos(pitch)cos(yaw), sin(pitch), cos(pitch)sin(yaw)).
    // At yaw=0, pitch=0 → (1, 0, 0) = +X.
    expectVec3Close(cam.forward, { x: 1, y: 0, z: 0 });
  });

  it('forward rotates to +Z at yaw=90° (pitch=0)', () => {
    const mat = new FakeMat4Ops();
    const cam = new Camera({ mat, yaw: Math.PI / 2 });
    // cos(0)*cos(90°)=0, sin(0)=0, cos(0)*sin(90°)=1 → (0,0,1)
    expectVec3Close(cam.forward, { x: 0, y: 0, z: 1 });
  });

  it('forward points up at pitch=+89° (clamped)', () => {
    const mat = new FakeMat4Ops();
    const cam = new Camera({ mat, pitch: Math.PI / 2 });
    // Pitch is clamped to 89°, so y is close to sin(89°) not 1.
    expect(cam.pitch).toBeCloseTo((89 * Math.PI) / 180, 6);
    expect(cam.forward.y).toBeCloseTo(Math.sin((89 * Math.PI) / 180), 6);
  });

  it('clamps pitch to (-89°, 89°)', () => {
    const mat = new FakeMat4Ops();
    const cam = new Camera({ mat });
    const limit = (89 * Math.PI) / 180;

    cam.pitch = Math.PI / 2;
    expect(cam.pitch).toBeCloseTo(limit, 6);

    cam.pitch = -Math.PI / 2;
    expect(cam.pitch).toBeCloseTo(-limit, 6);

    // Within range is untouched.
    cam.pitch = 0.5;
    expect(cam.pitch).toBe(0.5);
  });

  it('right and up are orthogonal to forward', () => {
    const mat = new FakeMat4Ops();
    const cam = new Camera({ mat, yaw: 0.7, pitch: 0.3 });
    const f = cam.forward;
    const r = cam.right;
    const u = cam.up;

    // dot products should be ~0
    expect(Math.abs(f.x * r.x + f.y * r.y + f.z * r.z)).toBeLessThan(1e-6);
    expect(Math.abs(f.x * u.x + f.y * u.y + f.z * u.z)).toBeLessThan(1e-6);
    expect(Math.abs(r.x * u.x + r.y * u.y + r.z * u.z)).toBeLessThan(1e-6);

    // All unit length.
    expect(Math.hypot(f.x, f.y, f.z)).toBeCloseTo(1, 6);
    expect(Math.hypot(r.x, r.y, r.z)).toBeCloseTo(1, 6);
    expect(Math.hypot(u.x, u.y, u.z)).toBeCloseTo(1, 6);
  });

  it('viewMatrix calls lookAt with (pos, pos+forward, up=(0,1,0))', () => {
    const mat = new FakeMat4Ops();
    const cam = new Camera({ mat, position: { x: 1, y: 2, z: 3 }, yaw: 0, pitch: 0 });
    const out = mat.mat4();
    cam.viewMatrix(out);

    expect(mat.lookAtCalls).toHaveLength(1);
    const call = mat.lookAtCalls[0]!;
    expectVec3Close(call.eye, { x: 1, y: 2, z: 3 });
    // target = pos + forward = (1+1, 2, 3) = (2, 2, 3)
    expectVec3Close(call.target, { x: 2, y: 2, z: 3 });
    expectVec3Close(call.up, { x: 0, y: 1, z: 0 });
  });

  it('projMatrix calls perspective with configured params', () => {
    const mat = new FakeMat4Ops();
    const cam = new Camera({
      mat,
      fov: 1.2,
      aspect: 2,
      near: 0.5,
      far: 500,
    });
    const out = mat.mat4();
    cam.projMatrix(out);

    expect(mat.perspectiveCalls).toHaveLength(1);
    const c = mat.perspectiveCalls[0]!;
    expect(c.fovy).toBe(1.2);
    expect(c.aspect).toBe(2);
    expect(c.near).toBe(0.5);
    expect(c.far).toBe(500);
  });

  it('setAspect updates the projection aspect', () => {
    const mat = new FakeMat4Ops();
    const cam = new Camera({ mat, aspect: 1 });
    cam.setAspect(16 / 9);
    const out = mat.mat4();
    cam.projMatrix(out);
    expect(mat.perspectiveCalls[0]!.aspect).toBeCloseTo(16 / 9, 6);
  });

  it('viewProjMatrix = proj * view (multiply called with proj, view in order)', () => {
    const mat = new FakeMat4Ops();
    const cam = new Camera({ mat });
    const out = mat.mat4();
    cam.viewProjMatrix(out);

    // Should have called perspective, lookAt, then multiply.
    expect(mat.perspectiveCalls).toHaveLength(1);
    expect(mat.lookAtCalls).toHaveLength(1);
    expect(mat.multiplyCalls).toHaveLength(1);

    // multiply(out, proj, view) — a=proj, b=view.
    const mul = mat.multiplyCalls[0]!;
    // The proj matrix was tagged with m[0]=1, view with m[0]=2.
    expect(mul.a.m[0]).toBe(1); // proj
    expect(mul.b.m[0]).toBe(2); // view
  });

  it('move updates position', () => {
    const mat = new FakeMat4Ops();
    const cam = new Camera({ mat, position: { x: 0, y: 0, z: 0 } });
    cam.move(1, 2, 3);
    expectVec3Close(cam.position, { x: 1, y: 2, z: 3 });
  });

  it('caches basis vectors (forward only recomputed when dirty)', () => {
    const mat = new FakeMat4Ops();
    const cam = new Camera({ mat });
    const f1 = cam.forward;
    // Same reference values; accessing again should not change.
    const f2 = cam.forward;
    expectVec3Close(f1, f2);
    // Changing yaw changes forward.
    cam.yaw = Math.PI / 2;
    const f3 = cam.forward;
    expectVec3Close(f3, { x: 0, y: 0, z: 1 });
  });
});

// ---------------------------------------------------------------------------
// FlyController
// ---------------------------------------------------------------------------

/** Fake input snapshot for FlyController. */
class FakeFlyInput implements FlyInput {
  private readonly downKeys: Set<string> = new Set();
  private mouseDx = 0;
  private mouseDy = 0;

  setDown(code: string): void {
    this.downKeys.add(code);
  }
  setMouse(dx: number, dy: number): void {
    this.mouseDx = dx;
    this.mouseDy = dy;
  }

  isDown(code: string): boolean {
    return this.downKeys.has(code);
  }
  wasPressed(_code: string): boolean {
    return false;
  }
  mouseDelta(): { dx: number; dy: number } {
    return { dx: this.mouseDx, dy: this.mouseDy };
  }
}

describe('FlyController', () => {
  it('moves forward along flattened horizontal direction', () => {
    const mat = new FakeMat4Ops();
    const cam = new Camera({ mat, yaw: 0, pitch: 0, position: { x: 0, y: 0, z: 0 } });
    const input = new FakeFlyInput();
    input.setDown('KeyW');
    const ctrl = new FlyController({ speed: 10 });
    ctrl.fly(1, input, cam);
    // yaw=0 → forward=+X, so after 1s at speed 10 → x=10.
    expect(cam.position.x).toBeCloseTo(10, 6);
    expect(cam.position.z).toBeCloseTo(0, 6);
  });

  it('applies mouse-look to yaw and pitch', () => {
    const mat = new FakeMat4Ops();
    const cam = new Camera({ mat });
    const input = new FakeFlyInput();
    input.setMouse(100, 50);
    const ctrl = new FlyController({ sensitivity: 0.01 });
    ctrl.fly(0, input, cam);
    // yaw -= dx * sens = -100 * 0.01 = -1
    expect(cam.yaw).toBeCloseTo(-1, 6);
    // pitch -= dy * sens = -50 * 0.01 = -0.5
    expect(cam.pitch).toBeCloseTo(-0.5, 6);
  });

  it('space/shift move in world Y', () => {
    const mat = new FakeMat4Ops();
    const cam = new Camera({ mat, position: { x: 0, y: 0, z: 0 } });
    const input = new FakeFlyInput();
    input.setDown('Space');
    const ctrl = new FlyController({ speed: 5 });
    ctrl.fly(2, input, cam);
    expect(cam.position.y).toBeCloseTo(10, 6);
  });
});
