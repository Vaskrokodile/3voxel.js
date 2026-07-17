/**
 * Camera-local math contract.
 *
 * The camera subsystem must not hard-import the core math module (it is built
 * in parallel and may not exist yet). Instead the demo/renderer injects a set
 * of matrix operations that satisfy this interface. This keeps the boundary
 * clean and makes the camera fully testable with a fake.
 */
import type { Mat4, Vec3 } from '../core/types.js';

/**
 * Minimal set of column-major Mat4 operations the camera needs.
 *
 * All matrices are column-major and use WebGPU NDC conventions (clip-space z
 * in [0,1]). The injected implementation is responsible for those details;
 * the camera only orchestrates calls.
 */
export interface Mat4Ops {
  /** Create a new zeroed (or identity, implementer's choice) Mat4. */
  mat4(): Mat4;
  /** Write a WebGPU perspective projection into `out` and return it. */
  mat4Perspective(out: Mat4, fovy: number, aspect: number, near: number, far: number): Mat4;
  /** Write a right-handed look-at view matrix into `out` and return it. */
  mat4LookAt(out: Mat4, eye: Vec3, target: Vec3, up: Vec3): Mat4;
  /** Write `a * b` (column-major) into `out` and return it. */
  mat4Multiply(out: Mat4, a: Mat4, b: Mat4): Mat4;
}

/**
 * Anything that can hand the camera a concrete set of matrix operations.
 * Typically the real math module; a fake in tests.
 */
export type Mat4Provider = Mat4Ops;
