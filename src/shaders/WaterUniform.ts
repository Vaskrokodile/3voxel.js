/**
 * Water uniform buffer layout + writer.
 *
 * The transparent (water) voxel shader needs per-frame water data: a tint
 * color, a depth fade factor, a vertex ripple amplitude, and the elapsed
 * time. These are packed into a single 32-byte uniform block that mirrors
 * the WGSL struct below.
 *
 * WebGPU uniform address space follows std140-style alignment rules:
 *   - `vec3<f32>`: alignment 16, size 12 (occupies a 16-byte slot, padded to vec4).
 *   - `f32`:       alignment 4, size 4.
 *
 * ```wgsl
 * struct WaterUniform {
 *   waterColor    : vec4<f32>,  // @offset(0)   (xyz = tint, w = 0)
 *   waterDepth    : f32,        // @offset(16)
 *   waveAmplitude : f32,        // @offset(20)
 *   time          : f32,        // @offset(24)
 *   _pad          : f32,        // @offset(28)
 * };
 * ```
 * Total: 32 bytes (2 × 16-byte slots).
 */

import type { Vec3 } from '../core/types.js';

/** CPU-side water uniform data. */
export interface WaterUniformData {
  /** Water tint color (linear). */
  readonly waterColor: Vec3;
  /** Water depth fade factor [0,1] controlling tint strength. */
  readonly waterDepth: number;
  /** Vertex ripple amplitude in world units. */
  readonly waveAmplitude: number;
  /** Elapsed time in seconds (drives UV scroll + ripple). */
  readonly time: number;
}

// ---- Exact byte offsets (see file header for the WGSL layout) ----
export const WATER_COLOR_OFFSET = 0;
export const WATER_DEPTH_OFFSET = 16;
export const WAVE_AMPLITUDE_OFFSET = 20;
export const WATER_TIME_OFFSET = 24;
/** Total struct size in bytes (must be a multiple of 16). */
export const WATER_UNIFORM_SIZE = 32;

/** Default water tint color (shallow blue). */
export const DEFAULT_WATER_COLOR: Vec3 = { x: 0.1, y: 0.4, z: 0.6 };
/** Default water depth fade factor. */
export const DEFAULT_WATER_DEPTH = 1.0;
/** Default vertex ripple amplitude (world units). */
export const DEFAULT_WAVE_AMPLITUDE = 0.05;

/**
 * Build a {@link WaterUniformData} with the engine defaults and an optional
 * time override. The demo can pass this straight to {@link WaterUniformWriter}
 * each frame after updating `time`.
 */
export function defaultWaterUniformData(time = 0): WaterUniformData {
  return {
    waterColor: { x: DEFAULT_WATER_COLOR.x, y: DEFAULT_WATER_COLOR.y, z: DEFAULT_WATER_COLOR.z },
    waterDepth: DEFAULT_WATER_DEPTH,
    waveAmplitude: DEFAULT_WAVE_AMPLITUDE,
    time,
  };
}

/** Scratch Float32Array view over a 32-byte block. */
const SCRATCH = new Float32Array(WATER_UNIFORM_SIZE / 4);

/**
 * Writes {@link WaterUniformData} into a GPU uniform buffer via the queue.
 *
 * Uses a single scratch `Float32Array` and one `writeBuffer` call. The
 * `waterColor` vec3 is written as a vec4 (w = 0) so the 16-byte slot is fully
 * populated.
 */
export class WaterUniformWriter {
  /** Total size of the water uniform block in bytes. */
  public static readonly SIZE = WATER_UNIFORM_SIZE;
  public static readonly WATER_COLOR_OFFSET = WATER_COLOR_OFFSET;
  public static readonly WATER_DEPTH_OFFSET = WATER_DEPTH_OFFSET;
  public static readonly WAVE_AMPLITUDE_OFFSET = WAVE_AMPLITUDE_OFFSET;
  public static readonly TIME_OFFSET = WATER_TIME_OFFSET;

  /**
   * @param buffer A uniform buffer of at least {@link WATER_UNIFORM_SIZE} bytes.
   * @param queue  The device queue to write through.
   * @param data   The water data to upload.
   */
  public write(buffer: GPUBuffer, queue: GPUQueue, data: WaterUniformData): void {
    const v = SCRATCH;
    v[0] = data.waterColor.x;
    v[1] = data.waterColor.y;
    v[2] = data.waterColor.z;
    v[3] = 0;
    v[4] = data.waterDepth;
    v[5] = data.waveAmplitude;
    v[6] = data.time;
    v[7] = 0;
    queue.writeBuffer(buffer, 0, v, 0, v.length);
  }
}
