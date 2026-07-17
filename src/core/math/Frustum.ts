import type { AABB, Mat4 } from '../types.js';
import type { Vec4 } from './Vec4.js';
import { vec4 } from './Vec4.js';

/**
 * View frustum represented as 6 planes, each a Vec4 where xyz is the plane
 * normal (pointing inward) and w is the signed distance from the origin.
 * Plane order: [left, right, bottom, top, near, far].
 */
export class Frustum {
  /** The 6 frustum planes (left, right, bottom, top, near, far). */
  readonly planes: Vec4[];

  constructor() {
    this.planes = [
      vec4(), vec4(), vec4(), vec4(), vec4(), vec4(),
    ];
  }
}

/**
 * Extract the 6 frustum planes from a WebGPU view-projection matrix
 * (clip-space z in [0, 1]). Normals point inward; planes are normalized.
 *
 * For a point p (with w=1), clip = M*p gives (xc, yc, zc, wc). A point is
 * inside the frustum when: -wc <= xc <= wc, -wc <= yc <= wc, 0 <= zc <= wc.
 * Each inequality defines a plane a*px + b*py + c*pz + d >= 0 whose
 * (a, b, c) is the inward normal and d is the signed distance.
 */
export function frustumFromViewProj(out: Frustum, viewProj: Mat4): Frustum {
  const m = viewProj.m;

  // Coefficient rows (each is the linear combination of input p that yields a
  // clip component): rowC = (coeff of px, py, pz, pw).
  // xc row: (m[0], m[4], m[8],  m[12])
  // yc row: (m[1], m[5], m[9],  m[13])
  // zc row: (m[2], m[6], m[10], m[14])
  // wc row: (m[3], m[7], m[11], m[15])
  const xc0 = m[0]!, xc1 = m[4]!, xc2 = m[8]!, xc3 = m[12]!;
  const yc0 = m[1]!, yc1 = m[5]!, yc2 = m[9]!, yc3 = m[13]!;
  const zc0 = m[2]!, zc1 = m[6]!, zc2 = m[10]!, zc3 = m[14]!;
  const wc0 = m[3]!, wc1 = m[7]!, wc2 = m[11]!, wc3 = m[15]!;

  // Plane = rowW +/- rowC (and rowZ / rowW - rowZ for depth).
  // normal = (coeff px, coeff py, coeff pz), distance = coeff pw.
  // left:   wc + xc >= 0
  setPlane(out.planes[0]!, wc0 + xc0, wc1 + xc1, wc2 + xc2, wc3 + xc3);
  // right:  wc - xc >= 0
  setPlane(out.planes[1]!, wc0 - xc0, wc1 - xc1, wc2 - xc2, wc3 - xc3);
  // bottom: wc + yc >= 0
  setPlane(out.planes[2]!, wc0 + yc0, wc1 + yc1, wc2 + yc2, wc3 + yc3);
  // top:    wc - yc >= 0
  setPlane(out.planes[3]!, wc0 - yc0, wc1 - yc1, wc2 - yc2, wc3 - yc3);
  // near:   zc >= 0
  setPlane(out.planes[4]!, zc0, zc1, zc2, zc3);
  // far:    wc - zc >= 0
  setPlane(out.planes[5]!, wc0 - zc0, wc1 - zc1, wc2 - zc2, wc3 - zc3);

  return out;
}

/** Normalize a plane (a, b, c, d) into xyz=normal, w=distance. */
function setPlane(p: Vec4, a: number, b: number, c: number, d: number): void {
  const len = Math.sqrt(a * a + b * b + c * c);
  if (len < 1e-12) {
    p.x = 0;
    p.y = 0;
    p.z = 0;
    p.w = 0;
    return;
  }
  const inv = 1 / len;
  p.x = a * inv;
  p.y = b * inv;
  p.z = c * inv;
  p.w = d * inv;
}

/**
 * Conservative frustum-AABB intersection: tests the box center against each
 * plane using the box's effective radius along the plane normal. Returns true
 * if the box is at least partially inside the frustum.
 */
export function frustumIntersectsAabb(frustum: Frustum, box: AABB): boolean {
  const cx = (box.min.x + box.max.x) * 0.5;
  const cy = (box.min.y + box.max.y) * 0.5;
  const cz = (box.min.z + box.max.z) * 0.5;
  const hx = (box.max.x - box.min.x) * 0.5;
  const hy = (box.max.y - box.min.y) * 0.5;
  const hz = (box.max.z - box.min.z) * 0.5;

  for (let i = 0; i < 6; i++) {
    const p = frustum.planes[i]!;
    // Effective radius = sum of half-extents projected onto the plane normal.
    const radius = Math.abs(p.x * hx) + Math.abs(p.y * hy) + Math.abs(p.z * hz);
    const dist = p.x * cx + p.y * cy + p.z * cz + p.w;
    if (dist < -radius) {
      return false;
    }
  }
  return true;
}
