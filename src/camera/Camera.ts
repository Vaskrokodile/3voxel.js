/**
 * Perspective fly camera for tdjs.
 *
 * ## Coordinate convention
 *
 * - Right-handed coordinate system, Y up.
 * - `yaw`   rotates around the +Y axis, in radians. yaw = 0 → forward = +X.
 * - `pitch` rotates around the camera's local right axis, clamped to
 *   (-89°, +89°) to avoid gimbal flip. pitch > 0 looks up.
 * - Forward is derived purely from yaw/pitch:
 *     forward = ( cos(pitch) * cos(yaw),  sin(pitch),  cos(pitch) * sin(yaw) )
 *   So at yaw = 0, pitch = 0 the forward vector is **+X**.
 * - `right` = normalize(cross(forward, worldUp)) where worldUp = (0,1,0).
 * - `up`    = cross(right, forward).
 * - The view matrix is `lookAt(position, position + forward, worldUp)`.
 * - The projection is WebGPU-style perspective (NDC z in [0,1]); the injected
 *   `mat4Perspective` handles that — the camera just calls it.
 *
 * Forward / right / up are cached and only recomputed when yaw, pitch, or
 * position change.
 */
import type { Mat4, Vec3 } from '../core/types.js';
import type { Mat4Ops } from './types.js';

/** Degrees-to-radians helper. */
const DEG2RAD = Math.PI / 180;

/** Pitch clamp just shy of ±90° to prevent the flip. */
const PITCH_LIMIT = 89 * DEG2RAD;

/** Default camera options. */
const DEFAULT_FOV = (60 * Math.PI) / 180;
const DEFAULT_ASPECT = 1;
const DEFAULT_NEAR = 0.1;
const DEFAULT_FAR = 1000;

/** Constructor options for {@link Camera}. */
export interface CameraOptions {
  /** Injected matrix operations (the camera never imports math directly). */
  readonly mat: Mat4Ops;
  /** Horizontal field of view in radians. Default 60°. */
  readonly fov?: number;
  /** Width / height. Default 1. */
  readonly aspect?: number;
  /** Near plane. Default 0.1. */
  readonly near?: number;
  /** Far plane. Default 1000. */
  readonly far?: number;
  /** Initial position. Default origin. */
  readonly position?: Vec3;
  /** Initial yaw (radians). Default 0. */
  readonly yaw?: number;
  /** Initial pitch (radians). Default 0. */
  readonly pitch?: number;
}

/**
 * A perspective fly camera. Owns position, yaw, pitch, and projection params;
 * delegates all matrix math to an injected {@link Mat4Ops}.
 */
export class Camera {
  private readonly mat: Mat4Ops;

  private _position: Vec3;
  private _yaw: number;
  private _pitch: number;

  private readonly _fov: number;
  private _aspect: number;
  private readonly _near: number;
  private readonly _far: number;

  // Cached basis vectors.
  private _forward: Vec3;
  private _right: Vec3;
  private _up: Vec3;
  /** True when the cached basis must be recomputed. */
  private _basisDirty: boolean;

  constructor(opts: CameraOptions) {
    this.mat = opts.mat;
    this._fov = opts.fov ?? DEFAULT_FOV;
    this._aspect = opts.aspect ?? DEFAULT_ASPECT;
    this._near = opts.near ?? DEFAULT_NEAR;
    this._far = opts.far ?? DEFAULT_FAR;
    this._position = { x: opts.position?.x ?? 0, y: opts.position?.y ?? 0, z: opts.position?.z ?? 0 };
    this._yaw = opts.yaw ?? 0;
    this._pitch = clampPitch(opts.pitch ?? 0);
    this._forward = { x: 0, y: 0, z: 0 };
    this._right = { x: 0, y: 0, z: 0 };
    this._up = { x: 0, y: 0, z: 0 };
    this._basisDirty = true;
  }

  /** World-space position (mutable copy). */
  get position(): Vec3 {
    return { x: this._position.x, y: this._position.y, z: this._position.z };
  }
  set position(v: Vec3) {
    this._position = { x: v.x, y: v.y, z: v.z };
    this._basisDirty = true;
  }

  /** Yaw in radians (around +Y). yaw = 0 → forward = +X. */
  get yaw(): number {
    return this._yaw;
  }
  set yaw(r: number) {
    this._yaw = r;
    this._basisDirty = true;
  }

  /** Pitch in radians, clamped to (-89°, +89°). */
  get pitch(): number {
    return this._pitch;
  }
  set pitch(r: number) {
    this._pitch = clampPitch(r);
    this._basisDirty = true;
  }

  /** Field of view (radians). Read-only after construction. */
  get fov(): number {
    return this._fov;
  }
  get near(): number {
    return this._near;
  }
  get far(): number {
    return this._far;
  }
  get aspect(): number {
    return this._aspect;
  }

  /** Update the projection aspect ratio (e.g. on canvas resize). */
  setAspect(a: number): void {
    this._aspect = a;
  }

  /** Unit forward vector (recomputed lazily). */
  get forward(): Vec3 {
    this.recomputeBasis();
    return { x: this._forward.x, y: this._forward.y, z: this._forward.z };
  }

  /** Unit right vector (recomputed lazily). */
  get right(): Vec3 {
    this.recomputeBasis();
    return { x: this._right.x, y: this._right.y, z: this._right.z };
  }

  /** Unit up vector (recomputed lazily). */
  get up(): Vec3 {
    this.recomputeBasis();
    return { x: this._up.x, y: this._up.y, z: this._up.z };
  }

  /**
   * Move the camera by a world-space delta (not camera-local). For fly input
   * use {@link FlyController} which converts WASD into camera-space motion.
   */
  move(dx: number, dy: number, dz: number): void {
    this._position = {
      x: this._position.x + dx,
      y: this._position.y + dy,
      z: this._position.z + dz,
    };
    this._basisDirty = true;
  }

  /**
   * Write the view matrix into `out` (lookAt(pos, pos+forward, up)) and
   * return it. The caller owns `out`'s lifetime; pass a fresh Mat4 each call
   * or reuse one.
   */
  viewMatrix(out: Mat4): Mat4 {
    this.recomputeBasis();
    const target: Vec3 = {
      x: this._position.x + this._forward.x,
      y: this._position.y + this._forward.y,
      z: this._position.z + this._forward.z,
    };
    return this.mat.mat4LookAt(out, this._position, target, { x: 0, y: 1, z: 0 });
  }

  /** Write the projection matrix into `out` and return it. */
  projMatrix(out: Mat4): Mat4 {
    return this.mat.mat4Perspective(out, this._fov, this._aspect, this._near, this._far);
  }

  /** Write `proj * view` into `out` and return it. */
  viewProjMatrix(out: Mat4): Mat4 {
    const view = this.mat.mat4();
    const proj = this.mat.mat4();
    this.viewMatrix(view);
    this.projMatrix(proj);
    return this.mat.mat4Multiply(out, proj, view);
  }

  /** Recompute forward/right/up if dirty. */
  private recomputeBasis(): void {
    if (!this._basisDirty) return;
    const cp = Math.cos(this._pitch);
    const sp = Math.sin(this._pitch);
    const cy = Math.cos(this._yaw);
    const sy = Math.sin(this._yaw);

    // forward = (cp*cy, sp, cp*sy)
    const f = { x: cp * cy, y: sp, z: cp * sy };
    normalize(f);
    this._forward = f;

    // right = normalize(cross(forward, worldUp))
    const r = cross(f, { x: 0, y: 1, z: 0 });
    normalize(r);
    this._right = r;

    // up = cross(right, forward)
    this._up = cross(r, f);

    this._basisDirty = false;
  }
}

/** Clamp pitch into (-89°, +89°). */
function clampPitch(r: number): number {
  if (r > PITCH_LIMIT) return PITCH_LIMIT;
  if (r < -PITCH_LIMIT) return -PITCH_LIMIT;
  return r;
}

/** In-place normalize of a Vec3 (no allocation beyond the param). */
function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v.x, v.y, v.z);
  if (len > 1e-12) {
    v.x /= len;
    v.y /= len;
    v.z /= len;
  }
  return v;
}

/** Cross product a × b, returned as a new Vec3. */
function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}
