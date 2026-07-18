/**
 * Shader subsystem public API.
 *
 * Reusable WGSL chunks, a fluent shader builder, a material system, and a
 * procedural texture atlas. Everything is composable and dependency-free.
 */

export {
  type ShaderChunk,
  CHUNKS,
  buildShader,
  registerChunk,
  getChunk,
  setWaterId,
  ShaderError,
} from './ShaderLibrary.js';

export { ShaderBuilder } from './ShaderBuilder.js';

export {
  type Material,
  type BlendMode,
  type CullMode,
  MaterialSystem,
  OPAQUE_VOXEL,
  TRANSPARENT_VOXEL,
  WIREFRAME,
  SKY,
} from './MaterialSystem.js';

export {
  type TextureEntry,
  type UVRect,
  type PixelGenerator,
  TextureAtlas,
  TextureAtlasError,
  DEFAULT_TILE_SIZE,
  DEFAULT_TILES_PER_ROW,
  DEFAULT_ROW_COUNT,
  registerBuiltinTextures,
  STONE_GENERATOR,
  DIRT_GENERATOR,
  GRASS_TOP_GENERATOR,
  GRASS_SIDE_GENERATOR,
  SAND_GENERATOR,
  WATER_GENERATOR,
  LOG_TOP_GENERATOR,
  LOG_SIDE_GENERATOR,
  LEAVES_GENERATOR,
  SNOW_GENERATOR,
} from './TextureAtlas.js';

export {
  type WaterUniformData,
  WaterUniformWriter,
  WATER_UNIFORM_SIZE,
  WATER_COLOR_OFFSET,
  WATER_DEPTH_OFFSET,
  WAVE_AMPLITUDE_OFFSET,
  WATER_TIME_OFFSET,
  DEFAULT_WATER_COLOR,
  DEFAULT_WATER_DEPTH,
  DEFAULT_WAVE_AMPLITUDE,
  defaultWaterUniformData,
} from './WaterUniform.js';

export { type PostProcessPass } from './PostProcess.js';
