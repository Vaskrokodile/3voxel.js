import { describe, it, expect } from 'vitest';
import {
  BiomeType,
  BIOME_BLOCKS,
  SEA_LEVEL,
  biomeBlocks,
  selectBiome,
} from '../Biome.js';

describe('Biome', () => {
  it('selects Ocean for height below sea level', () => {
    expect(selectBiome(SEA_LEVEL - 5, 0.5, 0.5)).toBe(BiomeType.Ocean);
    expect(selectBiome(0, 0.2, 0.2)).toBe(BiomeType.Ocean);
  });

  it('selects Beach just above sea level', () => {
    expect(selectBiome(SEA_LEVEL + 1, 0.5, 0.5)).toBe(BiomeType.Beach);
  });

  it('selects Desert for high temperature + low moisture', () => {
    expect(selectBiome(SEA_LEVEL + 10, 0.9, 0.1)).toBe(BiomeType.Desert);
  });

  it('selects Forest for high moisture at moderate height', () => {
    expect(selectBiome(SEA_LEVEL + 10, 0.3, 0.8)).toBe(BiomeType.Forest);
  });

  it('selects Mountains for high elevation', () => {
    expect(selectBiome(SEA_LEVEL + 30, 0.5, 0.5)).toBe(BiomeType.Mountains);
  });

  it('selects Plains as the default', () => {
    expect(selectBiome(SEA_LEVEL + 10, 0.3, 0.4)).toBe(BiomeType.Plains);
  });

  it('BIOME_BLOCKS has an entry for every biome', () => {
    for (const b of [
      BiomeType.Ocean,
      BiomeType.Beach,
      BiomeType.Plains,
      BiomeType.Forest,
      BiomeType.Mountains,
      BiomeType.Desert,
    ] as const) {
      const bb = biomeBlocks(b);
      expect(bb).toBe(BIOME_BLOCKS[b]);
      expect(typeof bb.surface).toBe('string');
      expect(typeof bb.filler).toBe('string');
    }
  });
});
