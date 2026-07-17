import { describe, it, expect } from 'vitest';
import type { BlockId, ChunkCoord } from '../../core/types.js';
import { AIR, CHUNK_SIZE } from '../../core/types.js';
import { TerrainGenerator } from '../TerrainGenerator.js';
import type {
  BlockRegistryLike,
  BlockTypeLike,
  VoxelChunkLike,
} from '../../world/types.js';

/** In-memory chunk used for tests. */
class FakeChunk implements VoxelChunkLike {
  readonly coord: ChunkCoord;
  private readonly blocks: Uint8Array;
  constructor(coord: ChunkCoord) {
    this.coord = coord;
    this.blocks = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE);
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

/** Registry with the block names TerrainGenerator expects. */
function makeRegistry(): BlockRegistryLike {
  const byName = new Map<string, BlockTypeLike>();
  const byId = new Map<number, BlockTypeLike>();
  const defs: Array<[string, boolean, boolean]> = [
    ['stone', true, false],
    ['dirt', true, false],
    ['grass', true, false],
    ['sand', true, false],
    ['water', false, true],
    ['snow', true, false],
  ];
  defs.forEach(([name, solid, transparent], i) => {
    const bt: BlockTypeLike = { id: i + 1, name, solid, transparent };
    byName.set(name, bt);
    byId.set(bt.id, bt);
  });
  return {
    get(id: BlockId): BlockTypeLike {
      const v = byId.get(id);
      if (!v) throw new Error(`unknown block id ${id}`);
      return v;
    },
    getByName(name: string): BlockTypeLike | undefined {
      return byName.get(name);
    },
  };
}

describe('TerrainGenerator', () => {
  it('fills a chunk deterministically (same seed => same blocks)', () => {
    const reg = makeRegistry();
    const coord: ChunkCoord = { x: 0, y: 0, z: 0 };
    const a = new FakeChunk(coord);
    const b = new FakeChunk(coord);
    const genA = new TerrainGenerator(42, reg);
    const genB = new TerrainGenerator(42, reg);
    genA.generate(a);
    genB.generate(b);
    for (let i = 0; i < CHUNK_SIZE ** 3; i++) {
      expect(a.getBlock(i % 16, Math.floor(i / 256), Math.floor((i % 256) / 16))).toBe(
        b.getBlock(i % 16, Math.floor(i / 256), Math.floor((i % 256) / 16)),
      );
    }
  });

  it('places a non-air surface block at the terrain height and air above', () => {
    const reg = makeRegistry();
    const gen = new TerrainGenerator(42, reg);
    const chunk = new FakeChunk({ x: 0, y: 2, z: 0 }); // y origin 32 ~= sea level
    gen.generate(chunk);
    // Find a column and verify surface is non-air and above is air (or water).
    let foundSurface = false;
    for (let lx = 0; lx < CHUNK_SIZE && !foundSurface; lx++) {
      for (let lz = 0; lz < CHUNK_SIZE && !foundSurface; lz++) {
        // scan top-down for first non-air
        for (let ly = CHUNK_SIZE - 1; ly >= 0; ly--) {
          const v = chunk.getBlock(lx, ly, lz);
          if (v !== AIR) {
            // surface found; above (if in-chunk) should be air or water
            foundSurface = true;
            if (ly + 1 < CHUNK_SIZE) {
              const above = chunk.getBlock(lx, ly + 1, lz);
              expect(above === AIR || above === reg.getByName('water')!.id).toBe(true);
            }
            break;
          }
        }
      }
    }
    expect(foundSurface).toBe(true);
  });

  it('produces at least one air pocket below the surface (caves) over a sample of chunks', () => {
    const reg = makeRegistry();
    const gen = new TerrainGenerator(123, reg);
    // Scan several chunks at moderate elevations where there is thick solid
    // material for caves to carve. Caves are probabilistic; aggregating over
    // a handful of chunks guarantees we observe at least one interior air
    // pocket (the cave threshold is tuned to produce visible caves).
    let caveAir = 0;
    for (let cx = 0; cx < 3; cx++) {
      for (let cz = 0; cz < 3; cz++) {
        const chunk = new FakeChunk({ x: cx, y: 1, z: cz });
        gen.generate(chunk);
        for (let ly = 0; ly < CHUNK_SIZE; ly++) {
          for (let lz = 0; lz < CHUNK_SIZE; lz++) {
            for (let lx = 0; lx < CHUNK_SIZE; lx++) {
              if (chunk.getBlock(lx, ly, lz) !== AIR) continue;
              // Interior air = air that has a solid block somewhere above it
              // in the same column (i.e. not open sky).
              let solidAbove = false;
              for (let ty = ly + 1; ty < CHUNK_SIZE; ty++) {
                if (chunk.getBlock(lx, ty, lz) !== AIR) {
                  solidAbove = true;
                  break;
                }
              }
              if (solidAbove) caveAir++;
            }
          }
        }
      }
    }
    expect(caveAir).toBeGreaterThan(0);
  });

  it('is continuous across chunk borders (neighboring columns match at x=0/15)', () => {
    const reg = makeRegistry();
    const gen = new TerrainGenerator(42, reg);
    const left = new FakeChunk({ x: 0, y: 0, z: 0 });
    const right = new FakeChunk({ x: 1, y: 0, z: 0 });
    gen.generate(left);
    gen.generate(right);
    // The column at world x=15 (left chunk lx=15) and world x=16 (right chunk
    // lx=0) won't be identical (different columns) but their *heights* should
    // be close (within a few blocks) because the heightmap is smooth.
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      let hLeft = 0;
      let hRight = 0;
      for (let ly = CHUNK_SIZE - 1; ly >= 0; ly--) {
        if (left.getBlock(15, ly, lz) !== AIR) {
          hLeft = ly;
          break;
        }
      }
      for (let ly = CHUNK_SIZE - 1; ly >= 0; ly--) {
        if (right.getBlock(0, ly, lz) !== AIR) {
          hRight = ly;
          break;
        }
      }
      expect(Math.abs(hLeft - hRight)).toBeLessThanOrEqual(8);
    }
  });
});
