/**
 * Biome classification and surface/filler block-name mapping.
 *
 * Biomes are selected from a (height, temperature, moisture) triple using
 * simple thresholds. The world module resolves the returned block NAMES via
 * its {@link BlockRegistryLike}; this keeps the generation layer free of a
 * hard dependency on the voxel registry.
 */
import type { BlockId } from '../core/types.js';

/** Biome categories supported by the terrain generator. */
export enum BiomeType {
  Ocean = 0,
  Beach = 1,
  Plains = 2,
  Forest = 3,
  Mountains = 4,
  Desert = 5,
}

/** Surface (top) and filler (sub-surface) block names for a biome. */
export interface BiomeBlocks {
  /** Block name placed at the terrain surface (e.g. 'grass'). */
  readonly surface: string;
  /** Block name placed below the surface (e.g. 'dirt'). */
  readonly filler: string;
}

/**
 * Per-biome surface/filler block names. The demo must register these names
 * in its block registry before generating terrain.
 */
export const BIOME_BLOCKS: Record<BiomeType, BiomeBlocks> = {
  [BiomeType.Ocean]: { surface: 'sand', filler: 'sand' },
  [BiomeType.Beach]: { surface: 'sand', filler: 'sand' },
  [BiomeType.Plains]: { surface: 'grass', filler: 'dirt' },
  [BiomeType.Forest]: { surface: 'grass', filler: 'dirt' },
  [BiomeType.Mountains]: { surface: 'stone', filler: 'stone' },
  [BiomeType.Desert]: { surface: 'sand', filler: 'sand' },
};

/**
 * Sea level (world Y). Columns whose terrain height is below this are filled
 * with water down to the column base. Exposed as a constant so callers and
 * tests can reason about it.
 */
export const SEA_LEVEL = 32;

/**
 * Select a biome from normalized climate + height inputs.
 *
 * @param height      Terrain column height (world Y).
 * @param temperature Normalized temperature in [0,1].
 * @param moisture    Normalized moisture in [0,1].
 * @returns The selected {@link BiomeType}.
 */
export function selectBiome(height: number, temperature: number, moisture: number): BiomeType {
  // Below sea level => ocean.
  if (height < SEA_LEVEL) return BiomeType.Ocean;
  // Just above sea level => beach.
  if (height <= SEA_LEVEL + 1) return BiomeType.Beach;
  // High elevation => mountains (snow handled by caller via 'snow' block).
  if (height >= SEA_LEVEL + 24) return BiomeType.Mountains;
  // Hot + dry => desert.
  if (temperature > 0.6 && moisture < 0.35) return BiomeType.Desert;
  // Moist, moderate => forest.
  if (moisture > 0.55) return BiomeType.Forest;
  // Default => plains.
  return BiomeType.Plains;
}

/**
 * Resolve the surface/filler block NAMES for a biome.
 *
 * Returns names (not BlockIds) so the caller resolves them through its
 * {@link BlockRegistryLike}. If a name is absent from the registry the
 * terrain generator skips placing that block.
 *
 * @param biome The biome type.
 * @returns The {@link BiomeBlocks} for that biome.
 */
export function biomeBlocks(biome: BiomeType): BiomeBlocks {
  return BIOME_BLOCKS[biome];
}

/**
 * Helper: resolve a block name to a BlockId via a registry, returning
 * {@link BlockId} (0 / AIR) if the name is not registered.
 *
 * This is a convenience for the terrain generator and is exported so tests
 * can reuse it. It accepts a minimal lookup shape to avoid importing the
 * voxel module.
 */
export function resolveBlockName(
  registry: { getByName(name: string): { id: BlockId } | undefined },
  name: string,
): BlockId {
  const bt = registry.getByName(name);
  return bt ? bt.id : 0;
}
