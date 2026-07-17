/**
 * Chunk terrain generator: fills a {@link VoxelChunkLike} with a heightmap +
 * 3D cave noise, placing biome-appropriate surface/filler blocks and water.
 *
 * Block NAME dependencies (the demo MUST register these names in its
 * {@link BlockRegistryLike} before generating; missing names are skipped and
 * the column falls back to stone or air):
 *   - 'stone'   — deep filler below the biome filler depth.
 *   - 'dirt'    — sub-surface filler for plains/forest.
 *   - 'grass'   — surface for plains/forest.
 *   - 'sand'    — surface/filler for ocean/beach/desert.
 *   - 'water'   — fills columns below sea level (optional; if absent, left
 *                 as air so the world renders dry basins).
 *   - 'snow'    — cap on high mountain peaks (optional).
 *
 * All sampling uses world-space coordinates derived from
 * `chunk.coord * CHUNK_SIZE` so terrain is continuous across chunk borders.
 */
import type { BlockId, ChunkCoord } from '../core/types.js';
import { AIR, CHUNK_SIZE } from '../core/types.js';
import { Noise } from './Noise.js';
import {
  BIOME_BLOCKS,
  BiomeType,
  SEA_LEVEL,
  biomeBlocks,
  resolveBlockName,
  selectBiome,
} from './Biome.js';
import type { BlockRegistryLike, VoxelChunkLike } from '../world/types.js';

/** Configuration constants for the terrain generator. */
const HEIGHT_BASE = SEA_LEVEL; // mean terrain height ~= sea level
const HEIGHT_AMP = 24; // heightmap amplitude above/below base
const FBM_OCTAVES = 4;
const FBM_LACUNARITY = 2.0;
const FBM_GAIN = 0.5;
const HEIGHT_SCALE = 0.0125; // world-units per noise unit (low freq => big features)

const CAVE_SCALE = 0.06;
const CAVE_THRESHOLD = 0.55; // |fbm3D| above this => carve air
const FILLER_DEPTH = 4; // dirt/sand depth below surface
const SNOW_HEIGHT = SEA_LEVEL + 30; // mountain snow cap

/**
 * Fills chunks with biome-based terrain, water, and 3D cave noise.
 *
 * Determinism: output depends only on `seed` and `chunk.coord`.
 */
export class TerrainGenerator {
  private readonly noise: Noise;
  private readonly caveNoise: Noise;
  private readonly registry: BlockRegistryLike;

  /**
   * @param seed     World seed (drives heightmap + cave noise).
   * @param registry Block registry used to resolve block NAMES to BlockIds.
   */
  constructor(seed: number, registry: BlockRegistryLike) {
    this.noise = new Noise(seed);
    // Offset cave noise seed so caves are decorrelated from the heightmap.
    this.caveNoise = new Noise((seed ^ 0x9e3779b9) >>> 0);
    this.registry = registry;
  }

  /**
   * Generate terrain into `chunk`. Mutates the chunk in place.
   *
   * The chunk is assumed to start filled with AIR; this method overwrites
   * every voxel in the chunk (so callers do not need to clear it first).
   */
  generate(chunk: VoxelChunkLike): void {
    const coord = chunk.coord;
    const originX = coord.x * CHUNK_SIZE;
    const originY = coord.y * CHUNK_SIZE;
    const originZ = coord.z * CHUNK_SIZE;

    // Resolve block ids once per chunk (cheap; avoids per-voxel lookups).
    const stone = resolveBlockName(this.registry, 'stone');
    const dirt = resolveBlockName(this.registry, 'dirt');
    const grass = resolveBlockName(this.registry, 'grass');
    const sand = resolveBlockName(this.registry, 'sand');
    const snow = resolveBlockName(this.registry, 'snow');
    const water = resolveBlockName(this.registry, 'water');

    const size = CHUNK_SIZE;

    for (let lz = 0; lz < size; lz++) {
      const wz = originZ + lz;
      for (let lx = 0; lx < size; lx++) {
        const wx = originX + lx;

        // Continental heightmap (fbm in [-1,1] => height in [base-amp, base+amp]).
        const h = this.noise.fbm2D(
          wx * HEIGHT_SCALE,
          wz * HEIGHT_SCALE,
          FBM_OCTAVES,
          FBM_LACUNARITY,
          FBM_GAIN,
        );
        const terrainHeight = Math.floor(HEIGHT_BASE + h * HEIGHT_AMP);

        // Climate noise for biome selection (low frequency).
        const temperature = (this.noise.noise2D(wx * 0.005 + 1000, wz * 0.005) + 1) * 0.5;
        const moisture = (this.noise.noise2D(wx * 0.005 + 2000, wz * 0.005 + 500) + 1) * 0.5;
        const biome = selectBiome(terrainHeight, temperature, moisture);
        const blocks = biomeBlocks(biome);
        const surfaceId = resolveBlockName(this.registry, blocks.surface);
        const fillerId = resolveBlockName(this.registry, blocks.filler);

        for (let ly = 0; ly < size; ly++) {
          const wy = originY + ly;
          let id: BlockId = AIR;

          if (wy <= terrainHeight) {
            // Solid column.
            const depthFromSurface = terrainHeight - wy;
            if (depthFromSurface === 0) {
              // Surface block.
              if (biome === BiomeType.Mountains && wy >= SNOW_HEIGHT && snow !== AIR) {
                id = snow;
              } else if (surfaceId !== AIR) {
                id = surfaceId;
              } else {
                id = stone !== AIR ? stone : AIR;
              }
            } else if (depthFromSurface <= FILLER_DEPTH) {
              // Filler layer.
              id = fillerId !== AIR ? fillerId : stone;
            } else {
              // Deep stone.
              id = stone;
            }

            // Carve caves with 3D noise (only inside solid terrain).
            if (id !== AIR) {
              const cave = this.caveNoise.fbm3D(
                wx * CAVE_SCALE,
                wy * CAVE_SCALE,
                wz * CAVE_SCALE,
                3,
                2.0,
                0.5,
              );
              if (Math.abs(cave) > CAVE_THRESHOLD) {
                id = AIR;
              }
            }
          } else if (wy <= SEA_LEVEL && water !== AIR) {
            // Water fill between terrain top and sea level.
            id = water;
          }

          chunk.setBlock(lx, ly, lz, id);
        }
      }
    }
  }

  /** Exposed for tests: the biome surface/filler block-name map. */
  static get BIOME_BLOCKS(): typeof BIOME_BLOCKS {
    return BIOME_BLOCKS;
  }
}
