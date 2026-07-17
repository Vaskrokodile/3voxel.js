import { describe, expect, it } from 'vitest';
import { MeshBuilder } from '../MeshBuilder.js';
import { VERTEX_STRIDE } from '../VertexLayout.js';

describe('MeshBuilder', () => {
  it('writes vertices and indices and reports counts', () => {
    const b = new MeshBuilder();
    const a = b.addVertex([0, 0, 0], [1, 0, 0], 3, 1, [0, 0]);
    const c = b.addVertex([1, 0, 0], [1, 0, 0], 3, 1, [1, 0]);
    const d = b.addVertex([1, 1, 0], [1, 0, 0], 3, 1, [1, 1]);
    const e = b.addVertex([0, 1, 0], [1, 0, 0], 3, 1, [0, 1]);
    b.addTriangle(a, c, d);
    b.addTriangle(a, d, e);
    const built = b.build();
    expect(built.vertexCount).toBe(4);
    expect(built.indexCount).toBe(6);
    expect(built.indexFormat).toBe('uint16');
    expect(built.vertices.length).toBe(4 * VERTEX_STRIDE);
    expect(built.indices.length).toBe(6 * 2);
  });

  it('upgrades to uint32 when vertex count exceeds 65535', () => {
    const b = new MeshBuilder();
    // Add 65536 vertices (one past the uint16 limit).
    for (let i = 0; i < 65536; i++) {
      b.addVertex([0, 0, 0], [1, 0, 0], 0, 1, [0, 0]);
    }
    // Add a triangle referencing the last three vertices.
    b.addTriangle(65533, 65534, 65535);
    const built = b.build();
    expect(built.vertexCount).toBe(65536);
    expect(built.indexFormat).toBe('uint32');
    // uint32 = 4 bytes per index.
    expect(built.indices.length).toBe(3 * 4);
  });

  it('keeps uint16 when vertex count is exactly 65535', () => {
    const b = new MeshBuilder();
    for (let i = 0; i < 65535; i++) {
      b.addVertex([0, 0, 0], [1, 0, 0], 0, 1, [0, 0]);
    }
    b.addTriangle(0, 1, 2);
    const built = b.build();
    expect(built.indexFormat).toBe('uint16');
  });

  it('tracks opaque and transparent index counts separately', () => {
    const b = new MeshBuilder();
    const v0 = b.addVertex([0, 0, 0], [1, 0, 0], 3, 1, [0, 0]);
    const v1 = b.addVertex([1, 0, 0], [1, 0, 0], 3, 1, [1, 0]);
    const v2 = b.addVertex([1, 1, 0], [1, 0, 0], 3, 1, [1, 1]);
    b.addTriangle(v0, v1, v2, false);
    b.addTriangle(v0, v1, v2, true);
    expect(b.getOpaqueIndexCount()).toBe(3);
    expect(b.getTransparentIndexCount()).toBe(3);
  });
});
