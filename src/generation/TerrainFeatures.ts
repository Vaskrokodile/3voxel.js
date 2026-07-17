/**
 * Post-generation terrain features: trees, ore veins, cacti, flowers, and snow
 * layers.
 *
 * This module is a *post-processor*: it runs AFTER {@link TerrainGenerator} has
 * filled a chunk with base terrain. It does not import or modify the base
 * generator; instead it reads the already-placed blocks and overwrites a small
 * subset to add surface decoration and underground ore veins.
 *
 * Determinism
 * -----------
 * All feature placement is driven by the seeded {@link Noise} instance using
 * **world-space** coordinates (`chunk.coord * CHUNK_SIZE + local`), so:
 *   - The same seed + same chunk always yields identical output.
 *   - Feature placement is stable regardless of chunk load order.
 *
 * Biome coupling
 * --------------
 * To decide which features belong on a column we need the column's biome. The
 * biome is derived from (height, temperature, moisture); the climate noise is
 * replicated here with the SAME formulas and seed used by {@link
 * TerrainGenerator} so the two agree. These magic numbers are duplicated by
 * design (the base generator is read-only); if the generator's climate
 * constants change, the constants below must change to match.
 *
 * Block NAME dependencies (resolved via {@link FeatureRegistry}; missing names
 * are silently skipped):
 *   - 'log'      — tree trunk        (REQUIRED for trees)
 *   - 'leaves'   — tree canopy       (REQUIRED for trees)
 *   - 'coal_ore', 'iron_ore', 'gold_ore', 'diamond_ore' — optional
 *   - 'cactus'   — optional (Desert)
 *   - 'flower_red', 'flower_yellow', 'tall_grass' — optional (cross-mesh;
 *     not rendered by the current mesher, but placed so they are ready)
 *   - 'snow'     — optional (Mountain snow layers)
 *   - 'stone', 'grass', 'sand', 'water' — read to detect surface material
 *
 * Cross-chunk limitation
 * ----------------------
 * Tree canopies are 3x3 in XZ and may extend one block into a neighboring
 * chunk. This pass only writes the portion that falls inside the current
 * chunk; the neighbor chunk does NOT receive the overhanging canopy half.
 * Cross-chunk canopy stitching (a second border pass) is future work.
 */
import type { BlockId, ChunkCoord } from '../core/types.js';
import { AIR, CHUNK_SIZE } from '../core/types.js';
import { Noise } from './Noise.js';
import { BiomeType, SEA_LEVEL, selectBiome } from './Biome.js';

/**
 * Minimal chunk surface for feature placement. Mirrors the relevant slice of
 * `voxel.Chunk` without importing the voxel module (keeps the generation layer
 * decoupled from sibling subsystems).
 */
export interface FeatureChunk {
  readonly coord: ChunkCoord;
  getBlock(lx: number, ly: number, lz: number): BlockId;
  setBlock(lx: number, ly: number, lz: number, id: BlockId): void;
}

/**
 * Minimal block-registry surface for feature placement. Only name->id lookup
 * is required.
 */
export interface FeatureRegistry {
  getByName(name: string): { id: BlockId } | undefined;
}

// --- Climate replication (must match TerrainGenerator) ---------------------
const CLIMATE_SCALE = 0.005;
const CLIMATE_TEMP_OFFSET = 1000;
const CLIMATE_MOIST_OFFSET_X = 2000;
const CLIMATE_MOIST_OFFSET_Z = 500;

// --- Feature tuning constants ---------------------------------------------
const SNOW_HEIGHT = SEA_LEVEL + 30; // matches TerrainGenerator.SNOW_HEIGHT

const TREE_NOISE_SCALE = 0.8;
/** Tree noise threshold; combined with a local-maximum test for sparsity. */
const TREE_THRESHOLD = 0.45;

const ORE_NOISE_SCALE = 0.1;
const ORE_COAL_THRESHOLD = 0.4; // common,   y < 60
const ORE_IRON_THRESHOLD = 0.5; // medium,   y < 40
const ORE_GOLD_THRESHOLD = 0.58; // rare,     y < 20
const ORE_DIAMOND_THRESHOLD = 0.64; // very rare, y < 12

const CACTUS_NOISE_SCALE = 0.9;
const CACTUS_THRESHOLD = 0.6;

const PLANT_NOISE_SCALE = 1.1;
const PLANT_THRESHOLD = 0.7;

/**
 * Post-generation feature placer. Deterministic given a fixed seed and
 * registry.
 */
export class TerrainFeatures {
  private readonly noise: Noise;
  private readonly registry: FeatureRegistry;

  /**
   * @param seed     World seed. MUST match the seed passed to
   *                  {@link TerrainGenerator} so biome classification agrees.
   * @param registry Block registry used to resolve feature block NAMES to ids.
   */
  constructor(seed: number, registry: FeatureRegistry) {
    this.noise = new Noise(seed);
    this.registry = registry;
  }

  /**
   * Apply features to `chunk` in place. Must be called AFTER the base terrain
   * generator has filled the chunk.
   *
   * Two passes run:
   *   1. Ore veins — replaces underground stone with ore blocks.
   *   2. Surface features — trees, cacti, flowers/tall grass, snow layers.
   */
  applyFeatures(chunk: FeatureChunk): void {
    const originX = chunk.coord.x * CHUNK_SIZE;
    const originY = chunk.coord.y * CHUNK_SIZE;
    const originZ = chunk.coord.z * CHUNK_SIZE;

    // Resolve all block ids once per chunk (cheap; avoids per-voxel lookups).
    const stone = this.resolve('stone');
    const grass = this.resolve('grass');
    const sand = this.resolve('sand');
    const water = this.resolve('water');
    const log = this.resolve('log');
    const leaves = this.resolve('leaves');
    const coalOre = this.resolve('coal_ore');
    const ironOre = this.resolve('iron_ore');
    const goldOre = this.resolve('gold_ore');
    const diamondOre = this.resolve('diamond_ore');
    const cactus = this.resolve('cactus');
    const flowerRed = this.resolve('flower_red');
    const flowerYellow = this.resolve('flower_yellow');
    const tallGrass = this.resolve('tall_grass');
    const snow = this.resolve('snow');

    this.applyOres(chunk, originX, originY, originZ, stone, coalOre, ironOre, goldOre, diamondOre);
    this.applySurfaceFeatures(
      chunk,
      originX,
      originY,
      originZ,
      stone,
      grass,
      sand,
      water,
      log,
      leaves,
      cactus,
      flowerRed,
      flowerYellow,
      tallGrass,
      snow,
    );
  }

  /** Resolve a block name to an id, returning AIR (0) if unregistered. */
  private resolve(name: string): BlockId {
    const bt = this.registry.getByName(name);
    return bt ? bt.id : AIR;
  }

  /**
   * Ore vein pass: replace stone with ore based on 3D noise and depth bands.
   * Rarer/deeper ores are checked first so diamond wins over coal where bands
   * overlap. If 'stone' is not registered (id == AIR) the pass is skipped
   * entirely, since we cannot identify stone blocks.
   */
  private applyOres(
    chunk: FeatureChunk,
    originX: number,
    originY: number,
    originZ: number,
    stone: BlockId,
    coalOre: BlockId,
    ironOre: BlockId,
    goldOre: BlockId,
    diamondOre: BlockId,
  ): void {
    if (stone === AIR) return;
    // Quick exit if no ore blocks are registered at all.
    if (coalOre === AIR && ironOre === AIR && goldOre === AIR && diamondOre === AIR) return;

    for (let ly = 0; ly < CHUNK_SIZE; ly++) {
      const wy = originY + ly;
      for (let lz = 0; lz < CHUNK_SIZE; lz++) {
        const wz = originZ + lz;
        for (let lx = 0; lx < CHUNK_SIZE; lx++) {
          if (chunk.getBlock(lx, ly, lz) !== stone) continue;
          const wx = originX + lx;
          const n = this.noise.noise3D(
            wx * ORE_NOISE_SCALE,
            wy * ORE_NOISE_SCALE,
            wz * ORE_NOISE_SCALE,
          );
          let ore: BlockId = AIR;
          // Deepest/rarest first.
          if (wy < 12 && n > ORE_DIAMOND_THRESHOLD && diamondOre !== AIR) {
            ore = diamondOre;
          } else if (wy < 20 && n > ORE_GOLD_THRESHOLD && goldOre !== AIR) {
            ore = goldOre;
          } else if (wy < 40 && n > ORE_IRON_THRESHOLD && ironOre !== AIR) {
            ore = ironOre;
          } else if (wy < 60 && n > ORE_COAL_THRESHOLD && coalOre !== AIR) {
            ore = coalOre;
          }
          if (ore !== AIR) chunk.setBlock(lx, ly, lz, ore);
        }
      }
    }
  }

  /**
   * Surface feature pass: trees, cacti, flowers/tall grass, snow layers.
   * Iterates per column, finds the surface block, classifies the biome, and
   * applies the biome-appropriate decoration.
   */
  private applySurfaceFeatures(
    chunk: FeatureChunk,
    originX: number,
    originY: number,
    originZ: number,
    stone: BlockId,
    grass: BlockId,
    sand: BlockId,
    water: BlockId,
    log: BlockId,
    leaves: BlockId,
    cactus: BlockId,
    flowerRed: BlockId,
    flowerYellow: BlockId,
    tallGrass: BlockId,
    snow: BlockId,
  ): void {
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      const wz = originZ + lz;
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const wx = originX + lx;

        // Find the surface: topmost non-air, non-water block in the column.
        let surfaceLy = -1;
        for (let ly = CHUNK_SIZE - 1; ly >= 0; ly--) {
          const b = chunk.getBlock(lx, ly, lz);
          if (b !== AIR && b !== water) {
            surfaceLy = ly;
            break;
          }
        }
        if (surfaceLy < 0) continue;

        const surfaceWy = originY + surfaceLy;
        // Only decorate land at or above sea level.
        if (surfaceWy < SEA_LEVEL) continue;

        const surfaceBlock = chunk.getBlock(lx, surfaceLy, lz);

        // Biome via replicated climate noise (coupled to TerrainGenerator).
        const temperature =
          (this.noise.noise2D(wx * CLIMATE_SCALE + CLIMATE_TEMP_OFFSET, wz * CLIMATE_SCALE) + 1) *
          0.5;
        const moisture =
          (this.noise.noise2D(
            wx * CLIMATE_SCALE + CLIMATE_MOIST_OFFSET_X,
            wz * CLIMATE_SCALE + CLIMATE_MOIST_OFFSET_Z,
          ) +
            1) *
          0.5;
        const biome = selectBiome(surfaceWy, temperature, moisture);

        // --- Trees (Plains / Forest, on grass) ---
        if (
          (biome === BiomeType.Plains || biome === BiomeType.Forest) &&
          surfaceBlock === grass &&
          log !== AIR &&
          leaves !== AIR
        ) {
          const tn = this.noise.noise2D(wx * TREE_NOISE_SCALE, wz * TREE_NOISE_SCALE);
          if (tn > TREE_THRESHOLD && this.isTreeLocalMax(wx, wz, tn)) {
            const hNoise =
              (this.noise.noise2D(wx * 1.7 + 777, wz * 1.7) + 1) * 0.5; // [0,1)
            const trunkH = 4 + Math.floor(hNoise * 3); // 4..6
            this.placeTree(chunk, lx, surfaceLy, lz, trunkH, log, leaves);
          }
        }

        // --- Cactus (Desert, on sand) ---
        if (biome === BiomeType.Desert && surfaceBlock === sand && cactus !== AIR) {
          const cn = this.noise.noise2D(wx * CACTUS_NOISE_SCALE + 31, wz * CACTUS_NOISE_SCALE);
          if (cn > CACTUS_THRESHOLD) {
            const chNoise =
              (this.noise.noise2D(wx * 1.3 + 91, wz * 1.3) + 1) * 0.5; // [0,1)
            const cactusH = 1 + Math.floor(chNoise * 3); // 1..3
            for (let i = 1; i <= cactusH && surfaceLy + i < CHUNK_SIZE; i++) {
              if (chunk.getBlock(lx, surfaceLy + i, lz) === AIR) {
                chunk.setBlock(lx, surfaceLy + i, lz, cactus);
              }
            }
          }
        }

        // --- Flowers / tall grass (Plains / Forest, on grass) ---
        if (
          (biome === BiomeType.Plains || biome === BiomeType.Forest) &&
          surfaceBlock === grass &&
          (flowerRed !== AIR || flowerYellow !== AIR || tallGrass !== AIR)
        ) {
          const pn = this.noise.noise2D(wx * PLANT_NOISE_SCALE + 412, wz * PLANT_NOISE_SCALE);
          if (
            pn > PLANT_THRESHOLD &&
            surfaceLy + 1 < CHUNK_SIZE &&
            chunk.getBlock(lx, surfaceLy + 1, lz) === AIR
          ) {
            const pick = (this.noise.noise2D(wx * 2.3 + 7, wz * 2.3) + 1) * 0.5; // [0,1)
            let plant: BlockId = AIR;
            if (pick < 0.34 && flowerRed !== AIR) {
              plant = flowerRed;
            } else if (pick < 0.67 && flowerYellow !== AIR) {
              plant = flowerYellow;
            } else if (tallGrass !== AIR) {
              plant = tallGrass;
            }
            if (plant !== AIR) chunk.setBlock(lx, surfaceLy + 1, lz, plant);
          }
        }

        // --- Snow layers (Mountains, high elevation) ---
        if (biome === BiomeType.Mountains && surfaceWy >= SNOW_HEIGHT && snow !== AIR) {
          if (surfaceLy + 1 < CHUNK_SIZE && chunk.getBlock(lx, surfaceLy + 1, lz) === AIR) {
            chunk.setBlock(lx, surfaceLy + 1, lz, snow);
          }
        }
      }
    }
  }

  /**
   * Place a single tree: a vertical trunk of `log` and a 2-layer 3x3
   * "sphere-ish" canopy of `leaves` on top. Only the parts that fall inside
   * the chunk are written (border canopy is clipped — see module limitation
   * note). The tree is skipped entirely if the trunk would exceed the chunk
   * top.
   */
  private placeTree(
    chunk: FeatureChunk,
    lx: number,
    surfaceLy: number,
    lz: number,
    trunkH: number,
    log: BlockId,
    leaves: BlockId,
  ): void {
    const trunkTop = surfaceLy + trunkH; // top trunk block local-y
    // Trunk must fit vertically; canopy clipping is handled per-block.
    if (trunkTop >= CHUNK_SIZE) return;

    // Trunk (surfaceLy+1 .. trunkTop).
    for (let i = 1; i <= trunkH; i++) {
      chunk.setBlock(lx, surfaceLy + i, lz, log);
    }

    // Canopy layer A: 3x3 at trunkTop + 1.
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        this.setLeafIfAir(chunk, lx + dx, trunkTop + 1, lz + dz, leaves);
      }
    }
    // Canopy layer B: plus-shape (center + 4 cardinals) at trunkTop + 2.
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (Math.abs(dx) + Math.abs(dz) <= 1) {
          this.setLeafIfAir(chunk, lx + dx, trunkTop + 2, lz + dz, leaves);
        }
      }
    }
  }

  /**
   * Write `id` at the given local coords iff the position is inside the chunk
   * and currently AIR. Used for canopy blocks so we never overwrite trunks or
   * existing decoration, and so out-of-bounds canopy is silently clipped.
   */
  private setLeafIfAir(
    chunk: FeatureChunk,
    lx: number,
    ly: number,
    lz: number,
    id: BlockId,
  ): void {
    if (
      lx >= 0 &&
      lx < CHUNK_SIZE &&
      ly >= 0 &&
      ly < CHUNK_SIZE &&
      lz >= 0 &&
      lz < CHUNK_SIZE &&
      chunk.getBlock(lx, ly, lz) === AIR
    ) {
      chunk.setBlock(lx, ly, lz, id);
    }
  }

  /**
   * Strict 4-neighbor local-maximum test for tree placement. Ensures trees are
   * sparse (one per noise peak) rather than clustered along threshold ridges.
   */
  private isTreeLocalMax(wx: number, wz: number, here: number): boolean {
    const s = TREE_NOISE_SCALE;
    return (
      here > this.noise.noise2D((wx + 1) * s, wz * s) &&
      here > this.noise.noise2D((wx - 1) * s, wz * s) &&
      here > this.noise.noise2D(wx * s, (wz + 1) * s) &&
      here > this.noise.noise2D(wx * s, (wz - 1) * s)
    );
  }
}
