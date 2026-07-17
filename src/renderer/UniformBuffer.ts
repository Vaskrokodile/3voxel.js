/**
 * Camera uniform buffer writer.
 *
 * Mirrors the WGSL uniform struct used by the voxel shaders. WebGPU's uniform
 * address space follows std140-style alignment rules:
 *   - `mat4x4<f32>`: alignment 16, size 64 (4 columns × 16 bytes).
 *   - `vec3<f32>`:   alignment 16, size 12 (occupies a 16-byte slot when
 *                    followed by other members; we treat it as vec4-sized).
 *   - `f32`:         alignment 4, size 4.
 *   - struct size is rounded up to the struct alignment (max member align = 16).
 *
 * The exact WGSL the renderer expects:
 * ```wgsl
 * struct CameraUniform {
 *   viewProj   : mat4x4<f32>,  // @offset(0)
 *   view       : mat4x4<f32>,  // @offset(64)
 *   proj       : mat4x4<f32>,  // @offset(128)
 *   cameraPos  : vec3<f32>,    // @offset(192)  (16-byte aligned, padded to vec4)
 *   time       : f32,          // @offset(208)
 *   _pad       : f32,          // @offset(212)
 * };
 * ```
 * Total size: 224 bytes (rounded up from 216 to a multiple of 16).
 *
 * Other subsystems (camera, world) that write into this block MUST use these
 * exact offsets.
 */

import type { Mat4, Vec3 } from '../core/types.js';

/** Logical camera uniform data (CPU side). */
export interface CameraUniformData {
  /** view-projection matrix (column-major Float32Array of length 16). */
  readonly viewProj: Mat4;
  /** view matrix. */
  readonly view: Mat4;
  /** projection matrix. */
  readonly proj: Mat4;
  /** world-space camera position. */
  readonly cameraPos: Vec3;
  /** elapsed time in seconds. */
  readonly time: number;
}

// ---- Exact byte offsets (see file header for the WGSL layout) ----
export const VIEW_PROJ_OFFSET = 0;
export const VIEW_OFFSET = 64;
export const PROJ_OFFSET = 128;
export const CAMERA_POS_OFFSET = 192;
export const TIME_OFFSET = 208;
/** Total struct size in bytes (must be a multiple of 16). */
export const CAMERA_UNIFORM_SIZE = 224;

/** Scratch Float32Array view over a 224-byte block. */
const SCRATCH = new Float32Array(CAMERA_UNIFORM_SIZE / 4);

/**
 * Write {@link CameraUniformData} into a GPU uniform buffer via the queue.
 *
 * Uses a single scratch `Float32Array` and one `writeBuffer` call to minimize
 * per-frame overhead. `cameraPos` is written as a vec4 (w = 0) so the 16-byte
 * slot is fully populated.
 */
export class CameraUniform {
  /** Total size of the camera uniform block in bytes. */
  public static readonly SIZE = CAMERA_UNIFORM_SIZE;
  public static readonly VIEW_PROJ_OFFSET = VIEW_PROJ_OFFSET;
  public static readonly VIEW_OFFSET = VIEW_OFFSET;
  public static readonly PROJ_OFFSET = PROJ_OFFSET;
  public static readonly CAMERA_POS_OFFSET = CAMERA_POS_OFFSET;
  public static readonly TIME_OFFSET = TIME_OFFSET;

  /**
   * @param buffer A uniform buffer of at least {@link CAMERA_UNIFORM_SIZE} bytes.
   * @param queue  The device queue to write through.
   * @param data   The camera data to upload.
   */
  public write(buffer: GPUBuffer, queue: GPUQueue, data: CameraUniformData): void {
    const view = SCRATCH;
    const vp = data.viewProj.m;
    const v = data.view.m;
    const p = data.proj.m;
    view.set(vp, VIEW_PROJ_OFFSET / 4);
    view.set(v, VIEW_OFFSET / 4);
    view.set(p, PROJ_OFFSET / 4);
    const cpBase = CAMERA_POS_OFFSET / 4;
    view[cpBase] = data.cameraPos.x;
    view[cpBase + 1] = data.cameraPos.y;
    view[cpBase + 2] = data.cameraPos.z;
    view[cpBase + 3] = 0; // padding (w)
    view[TIME_OFFSET / 4] = data.time;
    view[TIME_OFFSET / 4 + 1] = 0; // _pad
    queue.writeBuffer(buffer, 0, view, 0, view.length);
  }
}
