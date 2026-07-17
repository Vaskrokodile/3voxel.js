import type { Mat4, Vec3 } from '../types.js';
import type { Vec4 } from './Vec4.js';

/**
 * Mat4 storage is a 16-element Float32Array in column-major order
 * (WebGPU / WGSL convention). Column `c` and row `r` map to index `c*4 + r`:
 *
 *   m[0]  m[4]  m[8]  m[12]   // columns 0,1,2,3 — row 0
 *   m[1]  m[5]  m[9]  m[13]   // row 1
 *   m[2]  m[6]  m[10] m[14]   // row 2
 *   m[3]  m[7]  m[11] m[15]   // row 3
 *
 * Translation lives in m[12], m[13], m[14] (the 4th column, rows 0-2).
 * Vectors are column vectors; `out = M * v`.
 */

/** Create a new Mat4 wrapping a fresh identity Float32Array(16). */
export function mat4(): Mat4 {
  const m = new Float32Array(16);
  m[0] = 1;
  m[5] = 1;
  m[10] = 1;
  m[15] = 1;
  return { m };
}

/** Set `out` to the identity matrix and return `out`. */
export function mat4Identity(out: Mat4): Mat4 {
  const m = out.m;
  m.fill(0);
  m[0] = 1;
  m[5] = 1;
  m[10] = 1;
  m[15] = 1;
  return out;
}

/** Copy `src` into `out` and return `out`. */
export function mat4CopyInto(out: Mat4, src: Mat4): Mat4 {
  out.m.set(src.m);
  return out;
}

/**
 * Set `out` to `a * b` (column-major) and return `out`.
 * `out` may alias `a` or `b`.
 */
export function mat4Multiply(out: Mat4, a: Mat4, b: Mat4): Mat4 {
  const am = a.m;
  const bm = b.m;
  const a00 = am[0]!, a01 = am[1]!, a02 = am[2]!, a03 = am[3]!;
  const a10 = am[4]!, a11 = am[5]!, a12 = am[6]!, a13 = am[7]!;
  const a20 = am[8]!, a21 = am[9]!, a22 = am[10]!, a23 = am[11]!;
  const a30 = am[12]!, a31 = am[13]!, a32 = am[14]!, a33 = am[15]!;

  const b00 = bm[0]!, b01 = bm[1]!, b02 = bm[2]!, b03 = bm[3]!;
  const b10 = bm[4]!, b11 = bm[5]!, b12 = bm[6]!, b13 = bm[7]!;
  const b20 = bm[8]!, b21 = bm[9]!, b22 = bm[10]!, b23 = bm[11]!;
  const b30 = bm[12]!, b31 = bm[13]!, b32 = bm[14]!, b33 = bm[15]!;

  const m = out.m;
  m[0] = a00 * b00 + a10 * b01 + a20 * b02 + a30 * b03;
  m[1] = a01 * b00 + a11 * b01 + a21 * b02 + a31 * b03;
  m[2] = a02 * b00 + a12 * b01 + a22 * b02 + a32 * b03;
  m[3] = a03 * b00 + a13 * b01 + a23 * b02 + a33 * b03;

  m[4] = a00 * b10 + a10 * b11 + a20 * b12 + a30 * b13;
  m[5] = a01 * b10 + a11 * b11 + a21 * b12 + a31 * b13;
  m[6] = a02 * b10 + a12 * b11 + a22 * b12 + a32 * b13;
  m[7] = a03 * b10 + a13 * b11 + a23 * b12 + a33 * b13;

  m[8] = a00 * b20 + a10 * b21 + a20 * b22 + a30 * b23;
  m[9] = a01 * b20 + a11 * b21 + a21 * b22 + a31 * b23;
  m[10] = a02 * b20 + a12 * b21 + a22 * b22 + a32 * b23;
  m[11] = a03 * b20 + a13 * b21 + a23 * b22 + a33 * b23;

  m[12] = a00 * b30 + a10 * b31 + a20 * b32 + a30 * b33;
  m[13] = a01 * b30 + a11 * b31 + a21 * b32 + a31 * b33;
  m[14] = a02 * b30 + a12 * b31 + a22 * b32 + a32 * b33;
  m[15] = a03 * b30 + a13 * b31 + a23 * b32 + a33 * b33;
  return out;
}

/**
 * WebGPU perspective projection. NDC z maps to [0, 1] (NOT OpenGL [-1, 1]).
 * `fovy` in radians, `aspect` = width/height, `near`/`far` positive.
 */
export function mat4Perspective(
  out: Mat4,
  fovy: number,
  aspect: number,
  near: number,
  far: number,
): Mat4 {
  const f = 1 / Math.tan(fovy / 2);
  const m = out.m;
  m.fill(0);
  m[0] = f / aspect;
  m[5] = f;
  // WebGPU: z in [0,1]; maps eye-space -z to [0,1].
  m[10] = far / (near - far);
  m[11] = -1;
  m[14] = (near * far) / (near - far);
  return out;
}

/**
 * Right-handed look-at matrix (camera looking from `eye` to `target`, `up`).
 * Forward is `target - eye`; the camera's -Z axis points along forward.
 */
export function mat4LookAt(out: Mat4, eye: Vec3, target: Vec3, up: Vec3): Mat4 {
  let zx = eye.x - target.x;
  let zy = eye.y - target.y;
  let zz = eye.z - target.z;
  let zLen = Math.hypot(zx, zy, zz);
  if (zLen < 1e-12) {
    zLen = 1;
  }
  zx /= zLen;
  zy /= zLen;
  zz /= zLen;

  // x = normalize(cross(up, z))
  let xx = up.y * zz - up.z * zy;
  let xy = up.z * zx - up.x * zz;
  let xz = up.x * zy - up.y * zx;
  let xLen = Math.hypot(xx, xy, xz);
  if (xLen < 1e-12) {
    xx = 0;
    xy = 0;
    xz = 0;
  } else {
    xx /= xLen;
    xy /= xLen;
    xz /= xLen;
  }

  // y = cross(z, x)
  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;

  const m = out.m;
  m[0] = xx;
  m[1] = yx;
  m[2] = zx;
  m[3] = 0;
  m[4] = xy;
  m[5] = yy;
  m[6] = zy;
  m[7] = 0;
  m[8] = xz;
  m[9] = yz;
  m[10] = zz;
  m[11] = 0;
  m[12] = -(xx * eye.x + xy * eye.y + xz * eye.z);
  m[13] = -(yx * eye.x + yy * eye.y + yz * eye.z);
  m[14] = -(zx * eye.x + zy * eye.y + zz * eye.z);
  m[15] = 1;
  return out;
}

/** Set `out` to a translation matrix from `v`. */
export function mat4Translation(out: Mat4, v: Vec3): Mat4 {
  const m = out.m;
  m.fill(0);
  m[0] = 1;
  m[5] = 1;
  m[10] = 1;
  m[15] = 1;
  m[12] = v.x;
  m[13] = v.y;
  m[14] = v.z;
  return out;
}

/** Set `out` to a rotation matrix about the X axis by `rad` radians. */
export function mat4RotationX(out: Mat4, rad: number): Mat4 {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const m = out.m;
  m.fill(0);
  m[0] = 1;
  m[5] = c;
  m[6] = s;
  m[9] = -s;
  m[10] = c;
  m[15] = 1;
  return out;
}

/** Set `out` to a rotation matrix about the Y axis by `rad` radians. */
export function mat4RotationY(out: Mat4, rad: number): Mat4 {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const m = out.m;
  m.fill(0);
  m[0] = c;
  m[2] = -s;
  m[5] = 1;
  m[8] = s;
  m[10] = c;
  m[15] = 1;
  return out;
}

/** Set `out` to a rotation matrix about the Z axis by `rad` radians. */
export function mat4RotationZ(out: Mat4, rad: number): Mat4 {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const m = out.m;
  m.fill(0);
  m[0] = c;
  m[1] = s;
  m[4] = -s;
  m[5] = c;
  m[10] = 1;
  m[15] = 1;
  return out;
}

/** Set `out` to a scale matrix from `v`. */
export function mat4Scale(out: Mat4, v: Vec3): Mat4 {
  const m = out.m;
  m.fill(0);
  m[0] = v.x;
  m[5] = v.y;
  m[10] = v.z;
  m[15] = 1;
  return out;
}

/** Set `out` to the transpose of `a` and return `out`. */
export function mat4Transpose(out: Mat4, a: Mat4): Mat4 {
  const am = a.m;
  const m = out.m;
  const a01 = am[1]!, a02 = am[2]!, a03 = am[3]!;
  const a12 = am[6]!, a13 = am[7]!;
  const a23 = am[11]!;
  m[0] = am[0]!;
  m[1] = am[4]!;
  m[2] = am[8]!;
  m[3] = am[12]!;
  m[4] = a01;
  m[5] = am[5]!;
  m[6] = am[9]!;
  m[7] = am[13]!;
  m[8] = a02;
  m[9] = a12;
  m[10] = am[10]!;
  m[11] = am[14]!;
  m[12] = a03;
  m[13] = a13;
  m[14] = a23;
  m[15] = am[15]!;
  return out;
}

/**
 * Set `out` to the inverse of `a` and return `out`. Returns identity if `a`
 * is not invertible (determinant ~ 0).
 */
export function mat4Invert(out: Mat4, a: Mat4): Mat4 {
  const am = a.m;
  const a00 = am[0]!, a01 = am[1]!, a02 = am[2]!, a03 = am[3]!;
  const a10 = am[4]!, a11 = am[5]!, a12 = am[6]!, a13 = am[7]!;
  const a20 = am[8]!, a21 = am[9]!, a22 = am[10]!, a23 = am[11]!;
  const a30 = am[12]!, a31 = am[13]!, a32 = am[14]!, a33 = am[15]!;

  const b00 = a00 * a11 - a01 * a10;
  const b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11;
  const b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30;
  const b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31;
  const b11 = a22 * a33 - a23 * a32;

  let det =
    b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;

  if (Math.abs(det) < 1e-12) {
    return mat4Identity(out);
  }
  det = 1 / det;

  const m = out.m;
  m[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
  m[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
  m[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
  m[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
  m[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
  m[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
  m[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
  m[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
  m[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
  m[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
  m[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
  m[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
  m[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
  m[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
  m[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
  m[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
  return out;
}

/**
 * Transform point `v` (w=1) by `m`, storing the result in `outVec3`.
 * The result is dehomogenized (divided by w). Returns `outVec3`.
 */
export function mat4MultiplyVec3(outVec3: Vec3, m: Mat4, v: Vec3): Vec3 {
  const a = m.m;
  const x = v.x, y = v.y, z = v.z;
  let rx = a[0]! * x + a[4]! * y + a[8]! * z + a[12]!;
  let ry = a[1]! * x + a[5]! * y + a[9]! * z + a[13]!;
  let rz = a[2]! * x + a[6]! * y + a[10]! * z + a[14]!;
  let rw = a[3]! * x + a[7]! * y + a[11]! * z + a[15]!;
  if (rw !== 0 && rw !== 1) {
    const inv = 1 / rw;
    rx *= inv;
    ry *= inv;
    rz *= inv;
  }
  outVec3.x = rx;
  outVec3.y = ry;
  outVec3.z = rz;
  return outVec3;
}

/** Transform Vec4 `v` by `m`, storing the result in `outVec4`. Returns `outVec4`. */
export function mat4MultiplyVec4(outVec4: Vec4, m: Mat4, v: Vec4): Vec4 {
  const a = m.m;
  const x = v.x, y = v.y, z = v.z, w = v.w;
  outVec4.x = a[0]! * x + a[4]! * y + a[8]! * z + a[12]! * w;
  outVec4.y = a[1]! * x + a[5]! * y + a[9]! * z + a[13]! * w;
  outVec4.z = a[2]! * x + a[6]! * y + a[10]! * z + a[14]! * w;
  outVec4.w = a[3]! * x + a[7]! * y + a[11]! * z + a[15]! * w;
  return outVec4;
}
