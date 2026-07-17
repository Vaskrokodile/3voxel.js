/**
 * ao.ts — baked vertex ambient occlusion for voxel meshes.
 *
 * Standard voxel AO: for a face vertex, three neighboring blocks are sampled
 * in the plane one step away from the face along the face normal — two
 * "side" neighbors (adjacent orthogonally to the vertex) and one "corner"
 * neighbor (diagonal to the vertex). The occlusion level is:
 *
 *   - If side1 OR side2 is solid → ao = 0 (fully occluded corner).
 *   - Otherwise → ao = 3 - (solid(side1) + solid(side2) + solid(corner)),
 *     giving 3 (no occlusion) down to 0.
 *
 * `isSolid` should report whether a block id occludes (typically: the block's
 * `opaqueFaces` flag). AIR (0) is never solid.
 *
 * Returns 0..3 where 0 is darkest.
 */

import type { BlockId } from '../core/types.js';

export function vertexAO(
  side1: BlockId,
  side2: BlockId,
  corner: BlockId,
  isSolid: (id: BlockId) => boolean,
): number {
  if (isSolid(side1) || isSolid(side2)) {
    return 0;
  }
  return 3 - ((isSolid(side1) ? 1 : 0) + (isSolid(side2) ? 1 : 0) + (isSolid(corner) ? 1 : 0));
}
