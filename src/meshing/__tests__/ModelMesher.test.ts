import { describe, it, expect } from 'vitest';
import { buildModelMesh, type ModelInstance } from '../ModelMesher.js';
import { LANTERN_MODEL, PILLAR_MODEL } from '../../voxel/BlockModel.js';

describe('buildModelMesh', () => {
  it('emits 12 triangles per box (6 faces * 2 tris)', () => {
    const instances: ModelInstance[] = [
      { blockId: 1, model: PILLAR_MODEL, x: 0, y: 0, z: 0 },
    ];
    const mesh = buildModelMesh(instances);
    // PILLAR_MODEL has 1 box -> 4 verts per face * 6 faces = 24 verts, 36 indices.
    expect(mesh.vertexCount).toBe(24);
    expect(mesh.indexCount).toBe(36);
  });

  it('combines multiple instances into one mesh', () => {
    const instances: ModelInstance[] = [
      { blockId: 1, model: PILLAR_MODEL, x: 0, y: 0, z: 0 },
      { blockId: 2, model: PILLAR_MODEL, x: 1, y: 0, z: 0 },
    ];
    const mesh = buildModelMesh(instances);
    expect(mesh.vertexCount).toBe(48);
    expect(mesh.indexCount).toBe(72);
  });

  it('LANTERN_MODEL has 5 boxes -> 120 verts, 180 indices', () => {
    const mesh = buildModelMesh([
      { blockId: 3, model: LANTERN_MODEL, x: 0, y: 0, z: 0 },
    ]);
    expect(mesh.vertexCount).toBe(5 * 24);
    expect(mesh.indexCount).toBe(5 * 36);
  });

  it('produces a non-empty byte buffer', () => {
    const mesh = buildModelMesh([
      { blockId: 1, model: PILLAR_MODEL, x: 0, y: 0, z: 0 },
    ]);
    expect(mesh.vertices.byteLength).toBeGreaterThan(0);
    expect(mesh.indices.byteLength).toBeGreaterThan(0);
  });

  it('empty instance list yields an empty mesh', () => {
    const mesh = buildModelMesh([]);
    expect(mesh.vertexCount).toBe(0);
    expect(mesh.indexCount).toBe(0);
  });
});
