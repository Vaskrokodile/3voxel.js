/**
 * Scalar math utilities for tdjs.
 */

/** Small value used for floating-point comparisons. */
export const EPSILON = 1e-6;

/** Clamp `v` to the range [`min`, `max`]. */
export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/** Linear interpolation between `a` and `b` by `t` (unclamped). */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Convert degrees to radians. */
export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Convert radians to degrees. */
export function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

/** Returns true when `n` is a positive power of two. */
export function isPowerOfTwo(n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0;
}

/** Returns the smallest power of two >= `n` (1 for n<=1). */
export function nextPowerOfTwo(n: number): number {
  if (n <= 1) return 1;
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/**
 * Deterministic 32-bit integer hash of (x, y, z).
 * Suitable for noise / seeding; output is an unsigned 32-bit integer
 * represented as a JS number in [0, 4294967295].
 */
export function hashInt(x: number, y: number, z: number): number {
  // Use bitwise ops on 32-bit ints. The seed constants are arbitrary primes.
  let h = x | 0;
  h = Math.imul(h, 0x27d4eb2d);
  h = (h ^ (y | 0)) | 0;
  h = Math.imul(h, 0x165667b1);
  h = (h ^ (z | 0)) | 0;
  h = Math.imul(h, 0x9e3779b1);
  // Final avalanche (xorshift-style mixing).
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}
