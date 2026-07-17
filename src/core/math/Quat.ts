import type { Mat4 } from '../types.js';
import type { Vec3 } from '../types.js';
import { vec3NormalizeInto } from './Vec3.js';

/** Quaternion (x, y, z, w). Identity is (0, 0, 0, 1). */
export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

/** Create a new quaternion. Defaults to identity (0, 0, 0, 1). */
export function quat(x = 0, y = 0, z = 0, w = 1): Quat {
  return { x, y, z, w };
}

/** Copy `src` into `out` and return `out`. */
export function quatCopyInto(out: Quat, src: Quat): Quat {
  out.x = src.x;
  out.y = src.y;
  out.z = src.z;
  out.w = src.w;
  return out;
}

/**
 * Set `out` to a quaternion representing a rotation of `rad` radians about
 * the (normalized) `axis`. If `axis` has zero length, `out` becomes identity.
 */
export function quatFromAxisAngle(out: Quat, axis: Vec3, rad: number): Quat {
  const tmp = { x: 0, y: 0, z: 0 };
  vec3NormalizeInto(tmp, axis);
  if (tmp.x === 0 && tmp.y === 0 && tmp.z === 0) {
    out.x = 0;
    out.y = 0;
    out.z = 0;
    out.w = 1;
    return out;
  }
  const half = rad * 0.5;
  const s = Math.sin(half);
  out.x = tmp.x * s;
  out.y = tmp.y * s;
  out.z = tmp.z * s;
  out.w = Math.cos(half);
  return out;
}

/** Normalize `a` into `out` and return `out`. Zero-length yields identity. */
export function quatNormalize(out: Quat, a: Quat): Quat {
  const len = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z + a.w * a.w);
  if (len < 1e-12) {
    out.x = 0;
    out.y = 0;
    out.z = 0;
    out.w = 1;
    return out;
  }
  const inv = 1 / len;
  out.x = a.x * inv;
  out.y = a.y * inv;
  out.z = a.z * inv;
  out.w = a.w * inv;
  return out;
}

/** Set `out` to the Hamilton product `a * b` and return `out`. */
export function quatMultiply(out: Quat, a: Quat, b: Quat): Quat {
  const ax = a.x, ay = a.y, az = a.z, aw = a.w;
  const bx = b.x, by = b.y, bz = b.z, bw = b.w;
  out.x = aw * bx + ax * bw + ay * bz - az * by;
  out.y = aw * by - ax * bz + ay * bw + az * bx;
  out.z = aw * bz + ax * by - ay * bx + az * bw;
  out.w = aw * bw - ax * bx - ay * by - az * bz;
  return out;
}

/** Set `out` to the rotation matrix equivalent of `q` and return `out`. */
export function quatToMat4(out: Mat4, q: Quat): Mat4 {
  const x = q.x, y = q.y, z = q.z, w = q.w;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;

  const m = out.m;
  m[0] = 1 - (yy + zz);
  m[1] = xy + wz;
  m[2] = xz - wy;
  m[3] = 0;
  m[4] = xy - wz;
  m[5] = 1 - (xx + zz);
  m[6] = yz + wx;
  m[7] = 0;
  m[8] = xz + wy;
  m[9] = yz - wx;
  m[10] = 1 - (xx + yy);
  m[11] = 0;
  m[12] = 0;
  m[13] = 0;
  m[14] = 0;
  m[15] = 1;
  return out;
}

/**
 * Spherical linear interpolation between `a` and `b` by `t` into `out`.
 * Handles the antipodal case (negates `b` for the shorter path).
 */
export function quatSlerp(out: Quat, a: Quat, b: Quat, t: number): Quat {
  let bx = b.x, by = b.y, bz = b.z, bw = b.w;
  let cosHalfTheta = a.x * bx + a.y * by + a.z * bz + a.w * bw;
  if (cosHalfTheta < 0) {
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
    cosHalfTheta = -cosHalfTheta;
  }
  if (cosHalfTheta >= 1) {
    out.x = a.x;
    out.y = a.y;
    out.z = a.z;
    out.w = a.w;
    return out;
  }
  const halfTheta = Math.acos(cosHalfTheta);
  const sinHalfTheta = Math.sqrt(1 - cosHalfTheta * cosHalfTheta);
  if (Math.abs(sinHalfTheta) < 1e-6) {
    out.x = a.x * 0.5 + bx * 0.5;
    out.y = a.y * 0.5 + by * 0.5;
    out.z = a.z * 0.5 + bz * 0.5;
    out.w = a.w * 0.5 + bw * 0.5;
    return out;
  }
  const ratioA = Math.sin((1 - t) * halfTheta) / sinHalfTheta;
  const ratioB = Math.sin(t * halfTheta) / sinHalfTheta;
  out.x = a.x * ratioA + bx * ratioB;
  out.y = a.y * ratioA + by * ratioB;
  out.z = a.z * ratioA + bz * ratioB;
  out.w = a.w * ratioA + bw * ratioB;
  return out;
}
