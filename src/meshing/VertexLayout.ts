/**
 * VertexLayout.ts — exact interleaved vertex byte layout for chunk meshes.
 *
 * ── Byte map (stride = 36 bytes) ──────────────────────────────────────────
 *  offset  size  field      type        notes
 *  ──────  ────  ─────────  ──────────  ────────────────────────────────────
 *   0      12    position   3 × f32     world-space XYZ
 *  12      12    normal     3 × f32     unit face normal
 *  24       1    ao         1 × u8      baked vertex AO (0..3, 0=darkest)
 *  25       1    (pad)      —           alignment pad so blockId is 2-aligned
 *  26       2    blockId    1 × u16     indexes a per-block texture array
 *  28       8    uv         2 × f32     texture coords (voxel units, tiles)
 *  36       —    (next vertex starts at +36)
 *
 * Rationale: uv is stored as 2 × float32 (not float16) for correctness and
 * portability — DataView has no native float16 writer and WebGPU float16
 * support is non-universal. The 1-byte pad at offset 25 keeps `blockId`
 * (uint16) 2-byte aligned and the whole stride 4-byte aligned, which keeps
 * position/normal/uv on their natural alignments.
 *
 * The renderer must match VERTEX_STRIDE and the attribute offsets below when
 * building its GPVertexBufferLayout.
 */

import type { VertexAttribute } from './types.js';

/** Number of bytes per vertex. */
export const VERTEX_STRIDE = 36 as const;

/** Byte offset of each field within a vertex. */
export const OFFSETS = {
  position: 0,
  normal: 12,
  ao: 24,
  /** Padding byte at offset 25 (unused, reserved for alignment). */
  pad: 25,
  blockId: 26,
  uv: 28,
} as const;

/**
 * Attribute descriptors in declaration order. Identical to VERTEX_LAYOUT in
 * types.ts but defined here as the canonical source; types.ts re-exports the
 * constant for convenience.
 */
export const ATTRIBUTES: readonly VertexAttribute[] = [
  { name: 'position', format: 'float32x3', offset: OFFSETS.position },
  { name: 'normal', format: 'float32x3', offset: OFFSETS.normal },
  { name: 'ao', format: 'uint8', offset: OFFSETS.ao },
  { name: 'blockId', format: 'uint16', offset: OFFSETS.blockId },
  { name: 'uv', format: 'float32x2', offset: OFFSETS.uv },
] as const;
