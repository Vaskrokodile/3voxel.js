import { describe, expect, it } from 'vitest';
import { AIR, CHUNK_SIZE } from '../../core/types.js';
import type { BlockId, ChunkCoord } from '../../core/types.js';
import { DescriptorBlockRegistry, makeShellSampler } from '../chunkWorker.js';
import type { VoxelChunkLike } from '../../meshing/types.js';

/** Flag/meshType codes mirrored from chunkWorker.ts. */
const FLAG_SOLID = 1;
const FLAG_TRANSPARENT = 2;
const FLAG_OPAQUE_FACES = 4;
const MESH_NONE = 0;
const MESH_CUBE = 1;
const MESH_CROSS = 2;
const SHELL_FACE = CHUNK_SIZE * CHUNK_SIZE;
const DIR_NX = 0;
const DIR_PX = 1;
const DIR_NY = 2;
const DIR_PY = 3;
const DIR_NZ = 4;
const DIR_PZ = 5;

const STONE = 1;
const WATER = 2;
const PLANT = 3;

/** Tiny chunk backed by a Uint8Array; returns AIR out of range. */
class TinyChunk implements VoxelChunkLike {
  readonly coord: ChunkCoord;
  private readonly data: Uint8Array;
  constructor(coord: ChunkCoord) {
    this.coord = coord;
    this.data = new Uint8Array(CHUNK_SIZE ** 3);
  }
  set(lx: number, ly: number, lz: number, id: BlockId): void {
    this.data[lx + ly * CHUNK_SIZE + lz * CHUNK_SIZE * CHUNK_SIZE] = id;
  }
  getBlock(lx: number, ly: number, lz: number): BlockId {
    if (
      lx < 0 || lx >= CHUNK_SIZE ||
      ly < 0 || ly >= CHUNK_SIZE ||
      lz < 0 || lz >= CHUNK_SIZE
    ) {
      return AIR;
    }
    return this.data[lx + ly * CHUNK_SIZE + lz * CHUNK_SIZE * CHUNK_SIZE] ?? AIR;
  }
}

describe('DescriptorBlockRegistry', () => {
  it('classifies blocks from the per-palette descriptor arrays', () => {
    const paletteIds = new Uint32Array([AIR, STONE, WATER, PLANT]);
    const flags = new Uint8Array([
      0, // AIR
      FLAG_SOLID | FLAG_OPAQUE_FACES, // STONE
      FLAG_SOLID | FLAG_TRANSPARENT, // WATER (not opaque)
      0, // PLANT (not solid, not transparent, not opaque)
    ]);
    const meshTypes = new Uint8Array([MESH_NONE, MESH_CUBE, MESH_CUBE, MESH_CROSS]);

    const reg = new DescriptorBlockRegistry(paletteIds, flags, meshTypes);

    const air = reg.get(AIR)!;
    expect(air.meshType).toBe('none');
    expect(air.solid).toBe(false);

    const stone = reg.get(STONE)!;
    expect(stone.solid).toBe(true);
    expect(stone.transparent).toBe(false);
    expect(stone.opaqueFaces).toBe(true);
    expect(stone.meshType).toBe('cube');

    const water = reg.get(WATER)!;
    expect(water.solid).toBe(true);
    expect(water.transparent).toBe(true);
    expect(water.opaqueFaces).toBe(false);
    expect(water.meshType).toBe('cube');

    const plant = reg.get(PLANT)!;
    expect(plant.solid).toBe(false);
    expect(plant.transparent).toBe(false);
    expect(plant.opaqueFaces).toBe(false);
    expect(plant.meshType).toBe('cross');
  });

  it('falls back to opaque-cube for palette entries missing descriptor data', () => {
    const paletteIds = new Uint32Array([AIR, STONE]);
    // No flags / meshTypes provided.
    const reg = new DescriptorBlockRegistry(paletteIds, undefined, undefined);
    const stone = reg.get(STONE)!;
    expect(stone.solid).toBe(true);
    expect(stone.opaqueFaces).toBe(true);
    expect(stone.meshType).toBe('cube');
  });

  it('returns a stable cached object for repeated lookups', () => {
    const paletteIds = new Uint32Array([AIR, STONE]);
    const flags = new Uint8Array([0, FLAG_SOLID | FLAG_OPAQUE_FACES]);
    const meshTypes = new Uint8Array([MESH_NONE, MESH_CUBE]);
    const reg = new DescriptorBlockRegistry(paletteIds, flags, meshTypes);
    expect(reg.get(STONE)).toBe(reg.get(STONE));
  });
});

describe('makeShellSampler', () => {
  it('returns in-chunk blocks for in-range coordinates', () => {
    const chunk = new TinyChunk({ x: 0, y: 0, z: 0 });
    chunk.set(3, 4, 5, STONE);
    const shells = new Uint32Array(6 * SHELL_FACE);
    const sampler = makeShellSampler(chunk, { x: 0, y: 0, z: 0 }, shells);
    expect(sampler(3, 4, 5)).toBe(STONE);
    expect(sampler(0, 0, 0)).toBe(AIR);
  });

  it('returns the neighbor shell block for a +x out-of-chunk query', () => {
    const chunk = new TinyChunk({ x: 0, y: 0, z: 0 });
    const shells = new Uint32Array(6 * SHELL_FACE).fill(AIR);
    // +x neighbor has STONE at (ly=2, lz=3) on its touching face.
    shells[DIR_PX * SHELL_FACE + 2 * CHUNK_SIZE + 3] = STONE;
    const sampler = makeShellSampler(chunk, { x: 0, y: 0, z: 0 }, shells);
    // Out-of-chunk +x: lx = 16, ly = 2, lz = 3.
    expect(sampler(16, 2, 3)).toBe(STONE);
    // Adjacent AIR cell in the shell.
    expect(sampler(16, 2, 4)).toBe(AIR);
  });

  it('returns the neighbor shell block for a -x out-of-chunk query', () => {
    const chunk = new TinyChunk({ x: 0, y: 0, z: 0 });
    const shells = new Uint32Array(6 * SHELL_FACE).fill(AIR);
    shells[DIR_NX * SHELL_FACE + 1 * CHUNK_SIZE + 2] = STONE;
    const sampler = makeShellSampler(chunk, { x: 0, y: 0, z: 0 }, shells);
    expect(sampler(-1, 1, 2)).toBe(STONE);
  });

  it('returns the neighbor shell block for -y and +z queries', () => {
    const chunk = new TinyChunk({ x: 0, y: 0, z: 0 });
    const shells = new Uint32Array(6 * SHELL_FACE).fill(AIR);
    shells[DIR_NY * SHELL_FACE + 4 * CHUNK_SIZE + 5] = STONE; // -y neighbor, (lx=4, lz=5)
    shells[DIR_PZ * SHELL_FACE + 6 * CHUNK_SIZE + 7] = WATER; // +z neighbor, (lx=6, ly=7)
    const sampler = makeShellSampler(chunk, { x: 0, y: 0, z: 0 }, shells);
    expect(sampler(4, -1, 5)).toBe(STONE);
    expect(sampler(6, 7, 16)).toBe(WATER);
  });

  it('returns AIR for corner/edge samples that are out of range in two axes', () => {
    const chunk = new TinyChunk({ x: 0, y: 0, z: 0 });
    const shells = new Uint32Array(6 * SHELL_FACE).fill(STONE); // every shell cell solid
    const sampler = makeShellSampler(chunk, { x: 0, y: 0, z: 0 }, shells);
    // Corner sample: lx=-1, ly=-1 (out in two axes) => AIR, not a face shell.
    expect(sampler(-1, -1, 5)).toBe(AIR);
    // Edge sample: lx=16, lz=16 => AIR.
    expect(sampler(5, 8, 16)).toBe(STONE); // +z face, single axis out => shell
    expect(sampler(16, 8, 16)).toBe(AIR); // +x and +z out => corner => AIR
  });

  it('respects a non-zero world origin', () => {
    const chunk = new TinyChunk({ x: 1, y: 2, z: 3 });
    chunk.set(0, 0, 0, STONE);
    const shells = new Uint32Array(6 * SHELL_FACE).fill(AIR);
    shells[DIR_NX * SHELL_FACE + 0 * CHUNK_SIZE + 0] = WATER;
    const sampler = makeShellSampler(chunk, { x: 16, y: 32, z: 48 }, shells);
    // In-chunk at world (16, 32, 48) = local (0,0,0).
    expect(sampler(16, 32, 48)).toBe(STONE);
    // -x neighbor at world (15, 32, 48) = local (-1, 0, 0).
    expect(sampler(15, 32, 48)).toBe(WATER);
  });
});
