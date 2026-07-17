/**
 * tdjs math core — allocation-conscious vector/matrix/geometry primitives.
 *
 * All matrices are column-major (WebGPU/WGSL convention). Functions that
 * avoid allocations take an explicit `out` parameter (suffixed `Into` or
 * named with `out`).
 */
export * from './mathUtils.js';
export * from './Vec3.js';
export * from './Vec4.js';
export * from './Mat4.js';
export * from './Quat.js';
export * from './AABB.js';
export * from './Ray.js';
export * from './Frustum.js';
