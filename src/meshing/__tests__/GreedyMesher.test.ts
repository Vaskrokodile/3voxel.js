import { describe, expect, it } from 'vitest';
import { AIR, CHUNK_SIZE } from '../../core/types.js';
import type { BlockId, ChunkCoord } from '../../core/types.js';
import { GreedyMesher } from '../GreedyMesher.js';
import type { BlockRegistryLike, BlockTypeLike, NeighborSampler, VoxelChunkLike } from '../types.js';

/** Test chunk backed by a Uint8Array of BlockIds. */
class TestChunk implements VoxelChunkLike {
  readonly coord: ChunkCoord;
  private readonly data: Uint8Array;

  constructor(coord: ChunkCoord, data?: Uint8Array) {
    this.coord = coord;
    this.data = data ?? new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE);
  }

  set(lx: number, ly: number, lz: number, id: BlockId): void {
    this.data[lx + ly * CHUNK_SIZE + lz * CHUNK_SIZE * CHUNK_SIZE] = id;
  }

  getBlock(lx: number, ly: number, lz: number): BlockId {
    return this.data[lx + ly * CHUNK_SIZE + lz * CHUNK_SIZE * CHUNK_SIZE] ?? AIR;
  }
}

/** Registry with a few named block types. */
function makeRegistry(blocks: Record<number, Partial<BlockTypeLike>>): BlockRegistryLike {
  const map = new Map<BlockId, BlockTypeLike>();
  map.set(AIR, {
    id: AIR, name: 'air', solid: false, transparent: false, opaqueFaces: false, meshType: 'none',
  });
  for (const [idStr, partial] of Object.entries(blocks)) {
    const id = Number(idStr);
    map.set(id, {
      id,
      name: partial.name ?? `block_${id}`,
      solid: partial.solid ?? true,
      transparent: partial.transparent ?? false,
      opaqueFaces: partial.opaqueFaces ?? true,
      meshType: partial.meshType ?? 'cube',
    });
  }
  return { get: (id: BlockId) => map.get(id) };
}

const STONE = 1;
const WATER = 2;

const registry = makeRegistry({
  [STONE]: { name: 'stone', solid: true, transparent: false, opaqueFaces: true, meshType: 'cube' },
  [WATER]: { name: 'water', solid: true, transparent: true, opaqueFaces: false, meshType: 'cube' },
});

const airSampler: NeighborSampler = () => AIR;
const stoneSampler: NeighborSampler = () => STONE;

describe('GreedyMesher', () => {
  it('a single solid cube in an empty chunk emits 6 quads (24 verts / 36 indices), all opaque', () => {
    const chunk = new TestChunk({ x: 0, y: 0, z: 0 });
    chunk.set(8, 8, 8, STONE);
    const mesher = new GreedyMesher(registry);
    const mesh = mesher.mesh(chunk, { x: 0, y: 0, z: 0 }, airSampler);
    expect(mesh.vertexCount).toBe(24);
    expect(mesh.indexCount).toBe(36);
    expect(mesh.opaqueIndexCount).toBe(36);
    expect(mesh.transparentIndexCount).toBe(0);
    expect(mesh.indexFormat).toBe('uint16');
  });

  it('a 2x2x2 solid cube merges faces (indexCount < 6*2*6*3)', () => {
    const chunk = new TestChunk({ x: 0, y: 0, z: 0 });
    for (let x = 7; x <= 8; x++) {
      for (let y = 7; y <= 8; y++) {
        for (let z = 7; z <= 8; z++) {
          chunk.set(x, y, z, STONE);
        }
      }
    }
    const mesher = new GreedyMesher(registry);
    const mesh = mesher.mesh(chunk, { x: 0, y: 0, z: 0 }, airSampler);
    // 6 outer faces, each a single 2x2 merged quad => 24 verts / 36 indices.
    expect(mesh.indexCount).toBe(36);
    expect(mesh.indexCount).toBeLessThan(6 * 2 * 6 * 3);
    expect(mesh.opaqueIndexCount).toBe(36);
  });

  it('a chunk full of one block type with solid neighbors produces 0 indices', () => {
    const full = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE).fill(STONE);
    const chunk = new TestChunk({ x: 0, y: 0, z: 0 }, full);
    const mesher = new GreedyMesher(registry);
    // Sampler returns STONE outside the chunk => no exposed faces anywhere.
    const mesh = mesher.mesh(chunk, { x: 0, y: 0, z: 0 }, stoneSampler);
    expect(mesh.indexCount).toBe(0);
    expect(mesh.vertexCount).toBe(0);
    expect(mesh.opaqueIndexCount).toBe(0);
    expect(mesh.transparentIndexCount).toBe(0);
  });

  it('a transparent block emits into transparentIndexCount only', () => {
    const chunk = new TestChunk({ x: 0, y: 0, z: 0 });
    chunk.set(8, 8, 8, WATER);
    const mesher = new GreedyMesher(registry);
    const mesh = mesher.mesh(chunk, { x: 0, y: 0, z: 0 }, airSampler);
    expect(mesh.transparentIndexCount).toBeGreaterThan(0);
    expect(mesh.opaqueIndexCount).toBe(0);
    expect(mesh.indexCount).toBe(mesh.transparentIndexCount);
  });

  it('does not draw internal faces between two adjacent opaque solids', () => {
    const chunk = new TestChunk({ x: 0, y: 0, z: 0 });
    chunk.set(7, 8, 8, STONE);
    chunk.set(8, 8, 8, STONE);
    const mesher = new GreedyMesher(registry);
    const mesh = mesher.mesh(chunk, { x: 0, y: 0, z: 0 }, airSampler);
    // Two adjacent cubes share one internal face that must be culled.
    // The 4 outer faces that span both cubes (top/bottom/front/back) merge
    // into single 2x1 quads; the two end caps (left of cube 7, right of cube 8)
    // remain 1x1. Total = 6 quads => 24 verts / 36 indices, which is less than
    // the 72 indices two separate cubes would produce (2 * 36).
    expect(mesh.indexCount).toBe(36);
    expect(mesh.opaqueIndexCount).toBe(36);
    expect(mesh.indexCount).toBeLessThan(72);
  });
});
