import type { Vec3 } from '../types.js';

/** Create a new Vec3 with components (x, y, z). Defaults to (0,0,0). */
export function vec3(x = 0, y = 0, z = 0): Vec3 {
  return { x, y, z };
}

/** Set `out` components to (x, y, z) and return `out` (no allocation). */
export function vec3Set(out: Vec3, x: number, y: number, z: number): Vec3 {
  out.x = x;
  out.y = y;
  out.z = z;
  return out;
}

/** Copy `src` into `out` and return `out` (no allocation). */
export function vec3CopyInto(out: Vec3, src: Vec3): Vec3 {
  out.x = src.x;
  out.y = src.y;
  out.z = src.z;
  return out;
}

/** Return a new Vec3 equal to `a + b`. */
export function vec3Add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

/** Set `out` to `a + b` and return `out` (no allocation). */
export function vec3AddInto(out: Vec3, a: Vec3, b: Vec3): Vec3 {
  out.x = a.x + b.x;
  out.y = a.y + b.y;
  out.z = a.z + b.z;
  return out;
}

/** Return a new Vec3 equal to `a - b`. */
export function vec3Sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

/** Set `out` to `a - b` and return `out` (no allocation). */
export function vec3SubInto(out: Vec3, a: Vec3, b: Vec3): Vec3 {
  out.x = a.x - b.x;
  out.y = a.y - b.y;
  out.z = a.z - b.z;
  return out;
}

/** Return a new Vec3 equal to `a * s`. */
export function vec3Scale(a: Vec3, s: number): Vec3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

/** Set `out` to `a * s` and return `out` (no allocation). */
export function vec3ScaleInto(out: Vec3, a: Vec3, s: number): Vec3 {
  out.x = a.x * s;
  out.y = a.y * s;
  out.z = a.z * s;
  return out;
}

/** Dot product of `a` and `b`. */
export function vec3Dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/** Return a new Vec3 equal to the cross product `a x b`. */
export function vec3Cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

/** Set `out` to the cross product `a x b` and return `out` (no allocation). */
export function vec3CrossInto(out: Vec3, a: Vec3, b: Vec3): Vec3 {
  const ax = a.x, ay = a.y, az = a.z;
  const bx = b.x, by = b.y, bz = b.z;
  out.x = ay * bz - az * by;
  out.y = az * bx - ax * bz;
  out.z = ax * by - ay * bx;
  return out;
}

/** Euclidean length of `a`. */
export function vec3Length(a: Vec3): number {
  return Math.hypot(a.x, a.y, a.z);
}

/** Squared Euclidean length of `a` (avoids a sqrt). */
export function vec3LengthSquared(a: Vec3): number {
  return a.x * a.x + a.y * a.y + a.z * a.z;
}

/**
 * Return a new normalized Vec3. If `a` has zero length, returns (0,0,0).
 */
export function vec3Normalize(a: Vec3): Vec3 {
  const len = Math.hypot(a.x, a.y, a.z);
  if (len < 1e-12) return { x: 0, y: 0, z: 0 };
  const inv = 1 / len;
  return { x: a.x * inv, y: a.y * inv, z: a.z * inv };
}

/**
 * Normalize `a` into `out` and return `out`. Zero-length yields (0,0,0).
 */
export function vec3NormalizeInto(out: Vec3, a: Vec3): Vec3 {
  const len = Math.hypot(a.x, a.y, a.z);
  if (len < 1e-12) {
    out.x = 0;
    out.y = 0;
    out.z = 0;
    return out;
  }
  const inv = 1 / len;
  out.x = a.x * inv;
  out.y = a.y * inv;
  out.z = a.z * inv;
  return out;
}

/** Return a new Vec3 equal to `-a`. */
export function vec3Negate(a: Vec3): Vec3 {
  return { x: -a.x, y: -a.y, z: -a.z };
}

/** Set `out` to `-a` and return `out` (no allocation). */
export function vec3NegateInto(out: Vec3, a: Vec3): Vec3 {
  out.x = -a.x;
  out.y = -a.y;
  out.z = -a.z;
  return out;
}

/** Return a new Vec3 linearly interpolated between `a` and `b` by `t`. */
export function vec3Lerp(a: Vec3, b: Vec3, t: number): Vec3 {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  };
}

/** Set `out` to the lerp of `a` and `b` by `t` and return `out`. */
export function vec3LerpInto(out: Vec3, a: Vec3, b: Vec3, t: number): Vec3 {
  out.x = a.x + (b.x - a.x) * t;
  out.y = a.y + (b.y - a.y) * t;
  out.z = a.z + (b.z - a.z) * t;
  return out;
}

/** Euclidean distance between `a` and `b`. */
export function vec3Distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** Squared Euclidean distance between `a` and `b` (avoids a sqrt). */
export function vec3DistanceSquared(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

/** Return a new Vec3 with component-wise minima of `a` and `b`. */
export function vec3Min(a: Vec3, b: Vec3): Vec3 {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    z: Math.min(a.z, b.z),
  };
}

/** Return a new Vec3 with component-wise maxima of `a` and `b`. */
export function vec3Max(a: Vec3, b: Vec3): Vec3 {
  return {
    x: Math.max(a.x, b.x),
    y: Math.max(a.y, b.y),
    z: Math.max(a.z, b.z),
  };
}

/** True when `a` and `b` are component-wise equal (exact). */
export function vec3Equals(a: Vec3, b: Vec3): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z;
}

/**
 * Object pool for Vec3 to avoid allocations on hot paths.
 * Acquired vectors must be released when done; reuse after release is allowed.
 */
export class Vec3Pool {
  private readonly free: Vec3[] = [];
  private readonly inUse = new Set<Vec3>();

  /** Acquire a Vec3 from the pool (or allocate a new one). */
  acquire(): Vec3 {
    const v = this.free.pop() ?? vec3();
    this.inUse.add(v);
    return v;
  }

  /** Return `v` to the pool for reuse. */
  release(v: Vec3): void {
    if (this.inUse.delete(v)) {
      v.x = 0;
      v.y = 0;
      v.z = 0;
      this.free.push(v);
    }
  }

  /** Current number of available (free) vectors. */
  get freeCount(): number {
    return this.free.length;
  }
}
