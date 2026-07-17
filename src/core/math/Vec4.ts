/** 4-component vector (used for quaternions and frustum planes). */
export interface Vec4 {
  x: number;
  y: number;
  z: number;
  w: number;
}

/** Create a new Vec4 with components (x, y, z, w). Defaults to (0,0,0,0). */
export function vec4(x = 0, y = 0, z = 0, w = 0): Vec4 {
  return { x, y, z, w };
}

/** Set `out` components to (x, y, z, w) and return `out` (no allocation). */
export function vec4Set(out: Vec4, x: number, y: number, z: number, w: number): Vec4 {
  out.x = x;
  out.y = y;
  out.z = z;
  out.w = w;
  return out;
}

/** Copy `src` into `out` and return `out` (no allocation). */
export function vec4CopyInto(out: Vec4, src: Vec4): Vec4 {
  out.x = src.x;
  out.y = src.y;
  out.z = src.z;
  out.w = src.w;
  return out;
}

/** Dot product of `a` and `b`. */
export function vec4Dot(a: Vec4, b: Vec4): number {
  return a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
}

/** Euclidean length of `a`. */
export function vec4Length(a: Vec4): number {
  return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z + a.w * a.w);
}

/**
 * Normalize `a` into `out` and return `out`. Zero-length yields (0,0,0,0).
 */
export function vec4NormalizeInto(out: Vec4, a: Vec4): Vec4 {
  const len = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z + a.w * a.w);
  if (len < 1e-12) {
    out.x = 0;
    out.y = 0;
    out.z = 0;
    out.w = 0;
    return out;
  }
  const inv = 1 / len;
  out.x = a.x * inv;
  out.y = a.y * inv;
  out.z = a.z * inv;
  out.w = a.w * inv;
  return out;
}

/** True when `a` and `b` are component-wise equal (exact). */
export function vec4Equals(a: Vec4, b: Vec4): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z && a.w === b.w;
}
