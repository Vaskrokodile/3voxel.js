/**
 * tdjs — WebGPU-first voxel engine for infinite, detailed 3D worlds.
 *
 * Public API surface. Subsystems are grouped by concern; import the whole
 * engine via `import * as tdjs from 'tdjs'`, or pull a subsystem directly:
 * `import { Camera } from 'tdjs/camera'`.
 */

export * from './core/types.js';
export * from './core/math/index.js';
export * from './renderer/index.js';
export * from './voxel/index.js';

// Meshing: re-export public API but skip internal adapter types
// (VertexAttribute, VoxelChunkLike, BlockTypeLike, BlockRegistryLike) that
// mirror sibling modules. The renderer's VertexAttribute and the world
// module's *Like interfaces are the canonical public versions.
export {
  VERTEX_LAYOUT,
  VERTEX_STRIDE,
  OFFSETS,
  ATTRIBUTES,
  type NeighborSampler,
} from './meshing/index.js';
export { vertexAO } from './meshing/index.js';
export { MeshBuilder, type MeshBuilderBuildResult } from './meshing/index.js';
export { GreedyMesher } from './meshing/index.js';

export * from './threading/index.js';
export * from './world/index.js';
export * from './generation/index.js';
export * from './camera/index.js';
export * from './input/index.js';
export * from './culling/index.js';
export * from './physics/index.js';

// Interaction: re-export but skip the duplicate SolidChecker type
// (physics owns the canonical SolidChecker).
export {
  VoxelRaycaster,
  type RaycastHit,
  type VoxelRaycastWorld,
  type VoxelRaycasterOptions,
} from './interaction/index.js';
export {
  BlockEditor,
  type BlockEditorWorld,
  type BlockEditorOptions,
} from './interaction/index.js';
export {
  SelectionHighlight,
  type HighlightBox,
} from './interaction/index.js';

export * from './atmosphere/index.js';

export const VERSION = '0.2.0';
