import { describe, it, expect } from 'vitest';
import type { BlockId, ChunkCoord } from '../../core/types.js';
import { AIR, CHUNK_SIZE } from '../../core/types.js';
import { TerrainFeatures } from '../TerrainFeatures.js';
import type { FeatureChunk, FeatureRegistry } from '../TerrainFeatures.js';

/**
 * In-memory chunk for feature tests. Stores BlockIds in a Uint16Array so ids
 * above 255 are supported. Index order matches the voxel module:
 * `(ly * CHUNK_SIZE + lz) * CHUNK_SIZE + lx`.
 */
class FakeChunk implements FeatureChunk {
  readonly coord: ChunkCoord;
  private readonly blocks: Uint16Array;
  constructor(coord: ChunkCoord) {
    this.coord = coord;
    this.blocks = new Uint16Array(CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE);
  }
  private idx(lx: number, ly: number, lz: number): number {
    return (ly * CHUNK_SIZE + lz) * CHUNK_SIZE + lx;
  }
  getBlock(lx: number, ly: number, lz: number): BlockId {
    return this.blocks[this.idx(lx, ly, lz)] ?? AIR;
  }
  setBlock(lx: number, ly: number, lz: number, id: BlockId): void {
    this.blocks[this.idx(lx, ly, lz)] = id;
  }
}

/** Concrete registry mapping block names to ids. */
class FakeRegistry implements FeatureRegistry {
  private readonly byName: Map<string, BlockId>;
  constructor(entries: ReadonlyArray<readonly [string, BlockId]>) {
    this.byName = new Map(entries);
  }
  getByName(name: string): { id: BlockId } | undefined {
    const id = this.byName.get(name);
    return id === undefined ? undefined : { id };
  }
}

/** Block ids used across the tests. */
const STONE = 1;
const DIRT = 2;
const GRASS = 3;
const SAND = 4;
const WATER = 5;
const SNOW = 6;
const LOG = 7;
const LEAVES = 8;
const CACTUS = 9;
const FLOWER_RED = 10;
const FLOWER_YELLOW = 11;
const TALL_GRASS = 12;
const COAL_ORE = 20;
const IRON_ORE = 21;
const GOLD_ORE = 22;
const DIAMOND_ORE = 23;

/** Fill a chunk with a flat grass surface at `surfaceLy` (stone below, air above). */
function fillGrassSurface(chunk: FakeChunk, surfaceLy: number): void {
  for (let ly = 0; ly < CHUNK_SIZE; ly++) {
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        if (ly < surfaceLy) chunk.setBlock(lx, ly, lz, STONE);
        else if (ly === surfaceLy) chunk.setBlock(lx, ly, lz, GRASS);
        // else air (default)
      }
    }
  }
}

/** Fill a chunk entirely with one block id. */
function fillUniform(chunk: FakeChunk, id: BlockId): void {
  for (let ly = 0; ly < CHUNK_SIZE; ly++) {
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        chunk.setBlock(lx, ly, lz, id);
      }
    }
  }
}

/** Count voxels equal to `id` across the whole chunk. */
function countBlock(chunk: FakeChunk, id: BlockId): number {
  let n = 0;
  for (let ly = 0; ly < CHUNK_SIZE; ly++) {
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        if (chunk.getBlock(lx, ly, lz) === id) n++;
      }
    }
  }
  return n;
}

/** Registry with all feature-relevant blocks registered. */
function fullRegistry(): FakeRegistry {
  return new FakeRegistry([
    ['stone', STONE],
    ['dirt', DIRT],
    ['grass', GRASS],
    ['sand', SAND],
    ['water', WATER],
    ['snow', SNOW],
    ['log', LOG],
    ['leaves', LEAVES],
    ['cactus', CACTUS],
    ['flower_red', FLOWER_RED],
    ['flower_yellow', FLOWER_YELLOW],
    ['tall_grass', TALL_GRASS],
    ['coal_ore', COAL_ORE],
    ['iron_ore', IRON_ORE],
    ['gold_ore', GOLD_ORE],
    ['diamond_ore', DIAMOND_ORE],
  ]);
}

describe('TerrainFeatures', () => {
  it('places trees on grass surfaces above sea level', () => {
    const reg = new FakeRegistry([
      ['stone', STONE],
      ['grass', GRASS],
      ['log', LOG],
      ['leaves', LEAVES],
    ]);
    // Chunk at y=2 => originY=32. Surface at ly=5 => wy=37 (above sea level 32).
    const chunk = new FakeChunk({ x: 0, y: 2, z: 0 });
    fillGrassSurface(chunk, 5);

    const feat = new TerrainFeatures(1, reg);
    feat.applyFeatures(chunk);

    const logs = countBlock(chunk, LOG);
    const leaves = countBlock(chunk, LEAVES);
    expect(logs).toBeGreaterThan(0);
    expect(leaves).toBeGreaterThan(0);
  });

  it('replaces underground stone with ore', () => {
    const reg = new FakeRegistry([
      ['stone', STONE],
      ['coal_ore', COAL_ORE],
      ['iron_ore', IRON_ORE],
      ['gold_ore', GOLD_ORE],
      ['diamond_ore', DIAMOND_ORE],
    ]);
    // Chunk at y=0 => wy 0..15, all within diamond band (y < 12) for the lower
    // 12 layers and within coal band (y < 60) for all layers.
    const chunk = new FakeChunk({ x: 0, y: 0, z: 0 });
    fillUniform(chunk, STONE);

    const feat = new TerrainFeatures(99, reg);
    feat.applyFeatures(chunk);

    let ores = 0;
    for (let ly = 0; ly < CHUNK_SIZE; ly++) {
      for (let lz = 0; lz < CHUNK_SIZE; lz++) {
        for (let lx = 0; lx < CHUNK_SIZE; lx++) {
          const v = chunk.getBlock(lx, ly, lz);
          if (
            v === COAL_ORE ||
            v === IRON_ORE ||
            v === GOLD_ORE ||
            v === DIAMOND_ORE
          ) {
            ores++;
          }
        }
      }
    }
    expect(ores).toBeGreaterThan(0);
    // Some stone must remain (ores are sparse, not a full replacement).
    expect(countBlock(chunk, STONE)).toBeGreaterThan(0);
  });

  it('is deterministic (same seed + same chunk => same output)', () => {
    const reg = fullRegistry();
    const coord: ChunkCoord = { x: 1, y: 2, z: 3 };
    const a = new FakeChunk(coord);
    const b = new FakeChunk(coord);
    fillGrassSurface(a, 5);
    fillGrassSurface(b, 5);

    const fa = new TerrainFeatures(42, reg);
    const fb = new TerrainFeatures(42, reg);
    fa.applyFeatures(a);
    fb.applyFeatures(b);

    for (let ly = 0; ly < CHUNK_SIZE; ly++) {
      for (let lz = 0; lz < CHUNK_SIZE; lz++) {
        for (let lx = 0; lx < CHUNK_SIZE; lx++) {
          expect(a.getBlock(lx, ly, lz)).toBe(b.getBlock(lx, ly, lz));
        }
      }
    }
  });

  it('places no trees when log is absent (no crash)', () => {
    // Registry has leaves but no log; trees require both.
    const reg = new FakeRegistry([
      ['stone', STONE],
      ['grass', GRASS],
      ['leaves', LEAVES],
    ]);
    const chunk = new FakeChunk({ x: 0, y: 2, z: 0 });
    fillGrassSurface(chunk, 5);

    const feat = new TerrainFeatures(1, reg);
    feat.applyFeatures(chunk);

    // No trunk blocks placed (log unregistered) and no canopy (trees skipped).
    expect(countBlock(chunk, LEAVES)).toBe(0);
  });

  it('does not crash when no feature blocks are registered', () => {
    const reg = new FakeRegistry([
      ['stone', STONE],
      ['grass', GRASS],
    ]);
    const chunk = new FakeChunk({ x: 0, y: 2, z: 0 });
    fillGrassSurface(chunk, 5);
    const feat = new TerrainFeatures(7, reg);
    expect(() => feat.applyFeatures(chunk)).not.toThrow();
  });
});
