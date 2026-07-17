/**
 * Atmosphere uniform buffer layout + writer.
 *
 * The world shader needs per-frame atmosphere data: sun direction, sun color,
 * ambient color, fog color, and fog near/far distances. These are packed into a
 * single uniform block that mirrors the WGSL struct below.
 *
 * WebGPU uniform address space follows std140-style alignment rules:
 *   - `vec3<f32>`: alignment 16, size 12 (occupies a 16-byte slot, padded to vec4).
 *   - `f32`:       alignment 4, size 4.
 *
 * ```wgsl
 * struct AtmosphereUniform {
 *   sunDirection  : vec4<f32>,  // @offset(0)   (xyz = dir, w = 0)
 *   sunColor      : vec4<f32>,  // @offset(16)  (xyz = color, w = 0)
 *   ambientColor  : vec4<f32>,  // @offset(32)  (xyz = color, w = 0)
 *   fogColor      : vec4<f32>,  // @offset(48)  (xyz = color, w = 0)
 *   fogNear       : f32,        // @offset(64)
 *   fogFar        : f32,        // @offset(68)
 *   time          : f32,        // @offset(72)
 *   _pad          : f32,        // @offset(76)
 * };
 * ```
 * Total: 80 bytes (5 × 16-byte slots).
 */

import type { Vec3 } from '../core/types.js';

/** CPU-side atmosphere uniform data. */
export interface AtmosphereUniformData {
  /** Normalized direction pointing toward the sun (world space). */
  readonly sunDirection: Vec3;
  /** Sun light color (linear, HDR-ish). Warm at sunrise/sunset, white at noon. */
  readonly sunColor: Vec3;
  /** Ambient light color/intensity (sky-fill light). */
  readonly ambientColor: Vec3;
  /** Fog color (should match the sky horizon color). */
  readonly fogColor: Vec3;
  /** Fog start distance (world units). No fog before this. */
  readonly fogNear: number;
  /** Fog end distance (world units). Fully fogged beyond this. */
  readonly fogFar: number;
  /** Current time of day in [0, 24) hours. */
  readonly time: number;
  /** Padding to fill the final 16-byte slot. Always 0. */
  readonly _pad: number;
}

// ---- Exact byte offsets (see file header for the WGSL layout) ----
export const SUN_DIRECTION_OFFSET = 0;
export const SUN_COLOR_OFFSET = 16;
export const AMBIENT_COLOR_OFFSET = 32;
export const FOG_COLOR_OFFSET = 48;
export const FOG_NEAR_OFFSET = 64;
export const FOG_FAR_OFFSET = 68;
export const ATMOSPHERE_TIME_OFFSET = 72;
/** Total struct size in bytes (must be a multiple of 16). */
export const ATMOSPHERE_UNIFORM_SIZE = 80;

/** Scratch Float32Array view over an 80-byte block. */
const SCRATCH = new Float32Array(ATMOSPHERE_UNIFORM_SIZE / 4);

/**
 * Writes {@link AtmosphereUniformData} into a GPU uniform buffer via the queue.
 *
 * Uses a single scratch `Float32Array` and one `writeBuffer` call. Each `vec3`
 * field is written as a `vec4` (w = 0) so every 16-byte slot is fully populated.
 */
export class AtmosphereUniformWriter {
  /** Total size of the atmosphere uniform block in bytes. */
  public static readonly SIZE = ATMOSPHERE_UNIFORM_SIZE;
  public static readonly SUN_DIRECTION_OFFSET = SUN_DIRECTION_OFFSET;
  public static readonly SUN_COLOR_OFFSET = SUN_COLOR_OFFSET;
  public static readonly AMBIENT_COLOR_OFFSET = AMBIENT_COLOR_OFFSET;
  public static readonly FOG_COLOR_OFFSET = FOG_COLOR_OFFSET;
  public static readonly FOG_NEAR_OFFSET = FOG_NEAR_OFFSET;
  public static readonly FOG_FAR_OFFSET = FOG_FAR_OFFSET;
  public static readonly TIME_OFFSET = ATMOSPHERE_TIME_OFFSET;

  /**
   * @param buffer A uniform buffer of at least {@link ATMOSPHERE_UNIFORM_SIZE} bytes.
   * @param queue  The device queue to write through.
   * @param data   The atmosphere data to upload.
   */
  public write(buffer: GPUBuffer, queue: GPUQueue, data: AtmosphereUniformData): void {
    const v = SCRATCH;
    v[0] = data.sunDirection.x;
    v[1] = data.sunDirection.y;
    v[2] = data.sunDirection.z;
    v[3] = 0;
    v[4] = data.sunColor.x;
    v[5] = data.sunColor.y;
    v[6] = data.sunColor.z;
    v[7] = 0;
    v[8] = data.ambientColor.x;
    v[9] = data.ambientColor.y;
    v[10] = data.ambientColor.z;
    v[11] = 0;
    v[12] = data.fogColor.x;
    v[13] = data.fogColor.y;
    v[14] = data.fogColor.z;
    v[15] = 0;
    v[16] = data.fogNear;
    v[17] = data.fogFar;
    v[18] = data.time;
    v[19] = data._pad;
    queue.writeBuffer(buffer, 0, v, 0, v.length);
  }
}
