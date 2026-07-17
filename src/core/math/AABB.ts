import type { AABB, Mat4, Vec3 } from '../types.js';
import { vec3 } from './Vec3.js';

/** Create a new AABB from `min` and `max` corners (copied). */
export function aabb(min: Vec3, max: Vec3): AABB {
  return {
    min: { x: min.x, y: min.y, z: min.z },
    max: { x: max.x, y: max.y, z: max.z },
  };
}

/** Build an AABB that encloses all given points (empty input yields a zero box at origin). */
export function aabbFromPoints(points: readonly Vec3[]): AABB {
  if (points.length === 0) {
    return { min: vec3(0, 0, 0), max: vec3(0, 0, 0) };
  }
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.z < minZ) minZ = p.z;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
    if (p.z > maxZ) maxZ = p.z;
  }
  return {
    min: { x: minX, y: minY, z: minZ },
    max: { x: maxX, y: maxY, z: maxZ },
  };
}

/** Center of `box` written into `out` (or a new Vec3 if omitted). */
export function aabbCenter(box: AABB, out?: Vec3): Vec3 {
  const r = out ?? vec3();
  r.x = (box.min.x + box.max.x) * 0.5;
  r.y = (box.min.y + box.max.y) * 0.5;
  r.z = (box.min.z + box.max.z) * 0.5;
  return r;
}

/** Size (max - min) of `box` written into `out` (or a new Vec3 if omitted). */
export function aabbSize(box: AABB, out?: Vec3): Vec3 {
  const r = out ?? vec3();
  r.x = box.max.x - box.min.x;
  r.y = box.max.y - box.min.y;
  r.z = box.max.z - box.min.z;
  return r;
}

/** True when `p` lies within `box` (inclusive on all axes). */
export function aabbContainsPoint(box: AABB, p: Vec3): boolean {
  return (
    p.x >= box.min.x && p.x <= box.max.x &&
    p.y >= box.min.y && p.y <= box.max.y &&
    p.z >= box.min.z && p.z <= box.max.z
  );
}

/** True when `a` and `b` overlap (inclusive) on all axes. */
export function aabbIntersectsAabb(a: AABB, b: AABB): boolean {
  return (
    a.min.x <= b.max.x && a.max.x >= b.min.x &&
    a.min.y <= b.max.y && a.max.y >= b.min.y &&
    a.min.z <= b.max.z && a.max.z >= b.min.z
  );
}

/** Return a new AABB equal to `box` expanded by `amount` on every side. */
export function aabbExpand(box: AABB, amount: number): AABB {
  return {
    min: { x: box.min.x - amount, y: box.min.y - amount, z: box.min.z - amount },
    max: { x: box.max.x + amount, y: box.max.y + amount, z: box.max.z + amount },
  };
}

/**
 * Transform `box` by `mat4` into the AABB of the transformed 8 corners.
 * Writes the result into `out` and returns it.
 */
export function aabbTransform(out: AABB, box: AABB, mat: Mat4): AABB {
  const m = mat.m;
  const minX = box.min.x, minY = box.min.y, minZ = box.min.z;
  const maxX = box.max.x, maxY = box.max.y, maxZ = box.max.z;

  // Transform all 8 corners (w=1) and accumulate min/max.
  let loX = Infinity, loY = Infinity, loZ = Infinity;
  let hiX = -Infinity, hiY = -Infinity, hiZ = -Infinity;

  const corners: ReadonlyArray<readonly [number, number, number]> = [
    [minX, minY, minZ],
    [minX, minY, maxZ],
    [minX, maxY, minZ],
    [minX, maxY, maxZ],
    [maxX, minY, minZ],
    [maxX, minY, maxZ],
    [maxX, maxY, minZ],
    [maxX, maxY, maxZ],
  ];

  for (const [cx, cy, cz] of corners) {
    const rx = m[0]! * cx + m[4]! * cy + m[8]! * cz + m[12]!;
    const ry = m[1]! * cx + m[5]! * cy + m[9]! * cz + m[13]!;
    const rz = m[2]! * cx + m[6]! * cy + m[10]! * cz + m[14]!;
    if (rx < loX) loX = rx;
    if (ry < loY) loY = ry;
    if (rz < loZ) loZ = rz;
    if (rx > hiX) hiX = rx;
    if (ry > hiY) hiY = ry;
    if (rz > hiZ) hiZ = rz;
  }

  out.min.x = loX;
  out.min.y = loY;
  out.min.z = loZ;
  out.max.x = hiX;
  out.max.y = hiY;
  out.max.z = hiZ;
  return out;
}
