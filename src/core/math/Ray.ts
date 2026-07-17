import type { AABB, Vec3 } from '../types.js';
import { vec3NormalizeInto } from './Vec3.js';

/** A ray with an origin and a (normalized) direction. */
export interface Ray {
  readonly origin: Vec3;
  readonly dir: Vec3;
}

/** Create a ray; `dir` is normalized. Zero-length dir yields (0,0,0). */
export function ray(origin: Vec3, dir: Vec3): Ray {
  const d = { x: 0, y: 0, z: 0 };
  vec3NormalizeInto(d, dir);
  return {
    origin: { x: origin.x, y: origin.y, z: origin.z },
    dir: d,
  };
}

/** Point along `r` at distance `t` (new Vec3). */
export function rayAt(r: Ray, t: number): Vec3 {
  return {
    x: r.origin.x + r.dir.x * t,
    y: r.origin.y + r.dir.y * t,
    z: r.origin.z + r.dir.z * t,
  };
}

/**
 * Ray-AABB intersection via the slab method. Returns the near hit distance `t`
 * (>= 0) or `null` if the ray misses. A ray starting inside the box returns 0.
 */
export function rayIntersectsAabb(r: Ray, box: AABB): number | null {
  let tmin = -Infinity;
  let tmax = Infinity;

  const o = r.origin;
  const d = r.dir;

  // X slab
  if (Math.abs(d.x) < 1e-12) {
    if (o.x < box.min.x || o.x > box.max.x) return null;
  } else {
    const inv = 1 / d.x;
    let t1 = (box.min.x - o.x) * inv;
    let t2 = (box.max.x - o.x) * inv;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }

  // Y slab
  if (Math.abs(d.y) < 1e-12) {
    if (o.y < box.min.y || o.y > box.max.y) return null;
  } else {
    const inv = 1 / d.y;
    let t1 = (box.min.y - o.y) * inv;
    let t2 = (box.max.y - o.y) * inv;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }

  // Z slab
  if (Math.abs(d.z) < 1e-12) {
    if (o.z < box.min.z || o.z > box.max.z) return null;
  } else {
    const inv = 1 / d.z;
    let t1 = (box.min.z - o.z) * inv;
    let t2 = (box.max.z - o.z) * inv;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }

  // tmin is the entry point; reject if the box is entirely behind the ray.
  if (tmax < 0) return null;
  return tmin >= 0 ? tmin : 0;
}
