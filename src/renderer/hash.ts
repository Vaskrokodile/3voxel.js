/**
 * Internal hashing utilities for the renderer. Not part of the public API.
 *
 * Uses FNV-1a (32-bit) which is fast, deterministic, and good enough for
 * cache keys over WGSL source strings and pipeline descriptors. Collisions
 * are not a correctness risk here: a collision only means a cache hit for a
 * different-but-equal-keyed entry, and the key is built from all relevant
 * pipeline state, so true collisions are astronomically unlikely.
 */

/** Compute an FNV-1a 32-bit hash of a string, returned as hex. */
export function hashString(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    // FNV multiply (imul keeps 32-bit semantics w/o float rounding).
    h = Math.imul(h, 0x01000193);
  }
  // unsigned -> hex
  return (h >>> 0).toString(16).padStart(8, '0');
}
