/**
 * Tests for the shader chunk library: dependency ordering, de-duplication,
 * custom chunk registration, and basic WGSL content checks.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildShader,
  registerChunk,
  getChunk,
  CHUNKS,
  setWaterId,
  ShaderError,
} from '../ShaderLibrary.js';

describe('ShaderLibrary', () => {
  beforeEach(() => {
    setWaterId(8);
  });

  it('buildShader produces a string containing the requested struct definitions', () => {
    const src = buildShader(['camera_uniform', 'atmosphere_uniform']);
    expect(src).toContain('struct CameraUniform');
    expect(src).toContain('struct AtmosphereUniform');
    expect(src).toContain('viewProj');
    expect(src).toContain('sunDirection');
  });

  it('emits dependencies before dependents', () => {
    const src = buildShader(['sun_lighting']);
    // sun_lighting depends on atmosphere_uniform.
    const atmoIdx = src.indexOf('// chunk: atmosphere_uniform');
    const sunIdx = src.indexOf('// chunk: sun_lighting');
    expect(atmoIdx).toBeGreaterThanOrEqual(0);
    expect(sunIdx).toBeGreaterThan(atmoIdx);
  });

  it('transitively pulls in dependencies (apply_fog needs camera + atmosphere)', () => {
    const src = buildShader(['apply_fog']);
    expect(src).toContain('// chunk: camera_uniform');
    expect(src).toContain('// chunk: atmosphere_uniform');
    expect(src).toContain('// chunk: apply_fog');
    const camIdx = src.indexOf('// chunk: camera_uniform');
    const atmoIdx = src.indexOf('// chunk: atmosphere_uniform');
    const fogIdx = src.indexOf('// chunk: apply_fog');
    expect(atmoIdx).toBeGreaterThan(camIdx);
    expect(fogIdx).toBeGreaterThan(atmoIdx);
  });

  it('does not duplicate a chunk included multiple times', () => {
    const src = buildShader([
      'camera_uniform',
      'camera_uniform',
      'apply_fog',
      'sun_lighting',
    ]);
    const matches = src.match(/\/\/ chunk: camera_uniform/g);
    expect(matches).toHaveLength(1);
    const atmoMatches = src.match(/\/\/ chunk: atmosphere_uniform/g);
    expect(atmoMatches).toHaveLength(1);
  });

  it('throws on unknown chunk names', () => {
    expect(() => buildShader(['does_not_exist'])).toThrowError(ShaderError);
  });

  it('detects circular dependencies', () => {
    registerChunk({ name: 'cyc_a', source: '', dependencies: ['cyc_b'] });
    registerChunk({ name: 'cyc_b', source: '', dependencies: ['cyc_a'] });
    expect(() => buildShader(['cyc_a'])).toThrowError(ShaderError);
  });

  it('registerChunk adds a custom chunk that buildShader can resolve', () => {
    registerChunk({
      name: 'my_custom',
      source: 'fn myCustom() -> f32 { return 1.0; }',
    });
    const src = buildShader(['my_custom']);
    expect(src).toContain('fn myCustom()');
    expect(getChunk('my_custom')).toBeDefined();
  });

  it('water_id_const reflects setWaterId', () => {
    setWaterId(42);
    const src = buildShader(['water_id_const']);
    expect(src).toContain('const WATER_ID_U32 = 42u;');
  });

  it('water_effect depends on water_id_const', () => {
    const src = buildShader(['water_effect']);
    expect(src).toContain('const WATER_ID_U32');
    expect(src).toContain('fn waterAlpha');
    const constIdx = src.indexOf('// chunk: water_id_const');
    const effIdx = src.indexOf('// chunk: water_effect');
    expect(effIdx).toBeGreaterThan(constIdx);
  });

  it('CHUNKS exposes all built-in chunks', () => {
    expect(CHUNKS['camera_uniform']).toBeDefined();
    expect(CHUNKS['atmosphere_uniform']).toBeDefined();
    expect(CHUNKS['color_table']).toBeDefined();
    expect(CHUNKS['voxel_vertex_input']).toBeDefined();
    expect(CHUNKS['voxel_vertex_output']).toBeDefined();
    expect(CHUNKS['apply_fog']).toBeDefined();
    expect(CHUNKS['sun_lighting']).toBeDefined();
    expect(CHUNKS['unpack_block']).toBeDefined();
    expect(CHUNKS['water_effect']).toBeDefined();
  });

  it('voxel_vertex_output uses @interpolate(flat) on the integer attribute', () => {
    const src = buildShader(['voxel_vertex_output']);
    expect(src).toContain('@interpolate(flat) packed : u32');
  });
});
