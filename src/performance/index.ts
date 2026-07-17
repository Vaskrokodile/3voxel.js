/**
 * performance — adaptive performance subsystem.
 *
 * Re-exports the GPU mesh LRU cache, frame-budget scaler, and rolling
 * statistics tracker.
 */

export { MeshCache } from './MeshCache.js';
export type { CachedMesh } from './MeshCache.js';

export { FrameBudget } from './FrameBudget.js';
export type { FrameBudgetOptions } from './FrameBudget.js';

export { Stats } from './Stats.js';
export type { PerfStats } from './Stats.js';
