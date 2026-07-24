/**
 * ModelMesher — emits {@link BlockModel} geometry into a {@link MeshBuilder}.
 *
 * Each model box contributes six axis-aligned faces (12 triangles). Faces use
 * the standard voxel vertex layout (position / normal / ao / blockId / uv) so
 * they render with the same world pipeline as cube blocks. AO is set to full
 * (3) since model boxes don't participate in the baked-AO neighbour sampling.
 *
 * UVs are 0..1 per face so the atlas tile maps once per face (the world shader
 * applies `fract` for tiling, which is identity on [0,1]).
 */

import { MeshBuilder, type MeshBuilderBuildResult } from './MeshBuilder.js';
import type { BlockModel } from '../voxel/BlockModel.js';

/** A single model instance to mesh: a block id + model placed at a world cell. */
export interface ModelInstance {
  readonly blockId: number;
  readonly model: BlockModel;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * Build a single combined mesh from a list of model instances. The result uses
 * the same vertex layout as chunk meshes and can be uploaded to one pair of
 * GPU buffers and drawn with the world (opaque) pipeline.
 */
export function buildModelMesh(instances: readonly ModelInstance[]): MeshBuilderBuildResult {
  const builder = new MeshBuilder();
  for (const inst of instances) {
    for (const box of inst.model.boxes) {
      emitBox(builder, inst.x, inst.y, inst.z, box.min, box.max, inst.blockId);
    }
  }
  return builder.build();
}

/** Emit the six faces of one axis-aligned box (world-space min/max). */
function emitBox(
  builder: MeshBuilder,
  ox: number,
  oy: number,
  oz: number,
  min: readonly [number, number, number],
  max: readonly [number, number, number],
  blockId: number,
): void {
  const x0 = ox + min[0];
  const y0 = oy + min[1];
  const z0 = oz + min[2];
  const x1 = ox + max[0];
  const y1 = oy + max[1];
  const z1 = oz + max[2];

  // Each face: 4 corners (BL, BR, TR, TL) + 2 triangles, CCW from outside.
  // UVs are 0..1 per face. AO is full (3).

  // +X face (normal +X)
  emitQuad(builder, [x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0], [1, 0, 0], blockId);
  // -X face (normal -X)
  emitQuad(builder, [x0, y0, z1], [x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [-1, 0, 0], blockId);
  // +Y face (normal +Y, top)
  emitQuad(builder, [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], [0, 1, 0], blockId);
  // -Y face (normal -Y, bottom)
  emitQuad(builder, [x0, y0, z1], [x1, y0, z1], [x1, y0, z0], [x0, y0, z0], [0, -1, 0], blockId);
  // +Z face (normal +Z)
  emitQuad(builder, [x1, y0, z1], [x0, y0, z1], [x0, y1, z1], [x1, y1, z1], [0, 0, 1], blockId);
  // -Z face (normal -Z)
  emitQuad(builder, [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [0, 0, -1], blockId);
}

/** Emit one quad (BL, BR, TR, TL) as two triangles. */
function emitQuad(
  builder: MeshBuilder,
  bl: readonly [number, number, number],
  br: readonly [number, number, number],
  tr: readonly [number, number, number],
  tl: readonly [number, number, number],
  normal: readonly [number, number, number],
  blockId: number,
): void {
  const a = builder.addVertex(bl, normal, 3, blockId, [0, 0]);
  const b = builder.addVertex(br, normal, 3, blockId, [1, 0]);
  const c = builder.addVertex(tr, normal, 3, blockId, [1, 1]);
  const d = builder.addVertex(tl, normal, 3, blockId, [0, 1]);
  builder.addTriangle(a, b, c, false);
  builder.addTriangle(a, c, d, false);
}
