import { describe, expect, it } from 'vitest';
import type { MeshRequest, MeshResult, WorkerInbound, WorkerOutbound } from '../messages.js';

describe('messages', () => {
  it('round-trips a MeshRequest with all fields', () => {
    const blocks = new Uint8Array(4096).fill(0);
    const paletteIds = new Uint32Array([0, 1]);
    const req: MeshRequest = {
      type: 'mesh',
      id: 42,
      chunkCoord: { x: 3, y: -1, z: 7 },
      worldOrigin: { x: 48, y: -16, z: 112 },
      blocks,
      paletteIds,
    };
    // Simulate serialization round-trip (structured clone preserves typed arrays).
    const round: MeshRequest = structuredClone(req);
    expect(round.type).toBe('mesh');
    expect(round.id).toBe(42);
    expect(round.chunkCoord).toEqual({ x: 3, y: -1, z: 7 });
    expect(round.worldOrigin).toEqual({ x: 48, y: -16, z: 112 });
    expect(round.blocks.length).toBe(4096);
    expect(round.paletteIds[1]).toBe(1);
  });

  it('a MeshResult is a valid WorkerOutbound', () => {
    const result: MeshResult = {
      type: 'meshResult',
      id: 42,
      chunk: { x: 3, y: -1, z: 7 },
      vertices: new Uint8Array(36),
      indices: new Uint8Array(12),
      indexFormat: 'uint16',
      vertexCount: 1,
      indexCount: 6,
      opaqueIndexCount: 6,
      transparentIndexCount: 0,
    };
    const outbound: WorkerOutbound = result;
    expect(outbound.type).toBe('meshResult');
  });

  it('MeshRequest and GenRequest are valid WorkerInbound', () => {
    const meshReq: WorkerInbound = {
      type: 'mesh',
      id: 1,
      chunkCoord: { x: 0, y: 0, z: 0 },
      worldOrigin: { x: 0, y: 0, z: 0 },
      blocks: new Uint8Array(4096),
      paletteIds: new Uint32Array([0]),
    };
    const genReq: WorkerInbound = {
      type: 'gen',
      id: 2,
      chunkCoord: { x: 1, y: 1, z: 1 },
      seed: 12345,
    };
    expect(meshReq.type).toBe('mesh');
    expect(genReq.type).toBe('gen');
  });

  it('round-trips a MeshRequest carrying neighbor shells and block descriptors', () => {
    const blocks = new Uint8Array(4096).fill(0);
    const paletteIds = new Uint32Array([0, 1, 2]);
    const blockFlags = new Uint8Array([0, 1 | 4, 1 | 2]);
    const blockMeshType = new Uint8Array([0, 1, 1]);
    const neighborShells = new Uint32Array(6 * 16 * 16).fill(0);
    neighborShells[0] = 1; // -x neighbor shell has a solid block at (0,0)
    const req: MeshRequest = {
      type: 'mesh',
      id: 99,
      chunkCoord: { x: -2, y: 0, z: 5 },
      worldOrigin: { x: -32, y: 0, z: 80 },
      blocks,
      paletteIds,
      blockFlags,
      blockMeshType,
      neighborShells,
    };
    const round: MeshRequest = structuredClone(req);
    expect(round.blockFlags).toBeDefined();
    expect(round.blockFlags!.length).toBe(3);
    expect(round.blockFlags![1]).toBe(1 | 4);
    expect(round.blockMeshType).toBeDefined();
    expect(round.blockMeshType![2]).toBe(1);
    expect(round.neighborShells).toBeDefined();
    expect(round.neighborShells!.length).toBe(6 * 16 * 16);
    expect(round.neighborShells![0]).toBe(1);
  });

  it('round-trips a MeshResult carrying cross geometry buffers', () => {
    const result: MeshResult = {
      type: 'meshResult',
      id: 99,
      chunk: { x: -2, y: 0, z: 5 },
      vertices: new Uint8Array(0),
      indices: new Uint8Array(0),
      indexFormat: 'uint16',
      vertexCount: 0,
      indexCount: 0,
      opaqueIndexCount: 0,
      transparentIndexCount: 0,
      crossVertices: new Uint8Array(8 * 36),
      crossIndices: new Uint8Array(12 * 2),
      crossIndexFormat: 'uint16',
      crossVertexCount: 8,
      crossIndexCount: 12,
    };
    const round: MeshResult = structuredClone(result);
    expect(round.crossVertexCount).toBe(8);
    expect(round.crossIndexCount).toBe(12);
    expect(round.crossIndexFormat).toBe('uint16');
    expect(round.crossVertices!.length).toBe(8 * 36);
  });
});
