/**
 * Atmosphere subsystem — sky rendering, fog, and day/night cycle.
 *
 * Public API:
 *   - {@link SkyRenderer} — full-screen sky dome with gradient + sun/moon.
 *   - {@link Fog} / {@link fogWgslSnippet} — distance fog + WGSL snippet.
 *   - {@link DayNightCycle} — time-of-day management.
 *   - {@link AtmosphereUniformWriter} / {@link AtmosphereUniformData} — uniform
 *     buffer layout for the world shader.
 */

export { SkyRenderer, SKY_VERTEX_LAYOUT, type SkyOptions } from './SkyRenderer.js';
export { Fog, fogWgslSnippet, type FogOptions } from './Fog.js';
export { DayNightCycle } from './DayNightCycle.js';
export {
  AtmosphereUniformWriter,
  ATMOSPHERE_UNIFORM_SIZE,
  SUN_DIRECTION_OFFSET,
  SUN_COLOR_OFFSET,
  AMBIENT_COLOR_OFFSET,
  FOG_COLOR_OFFSET,
  FOG_NEAR_OFFSET,
  FOG_FAR_OFFSET,
  ATMOSPHERE_TIME_OFFSET,
  type AtmosphereUniformData,
} from './AtmosphereUniforms.js';
