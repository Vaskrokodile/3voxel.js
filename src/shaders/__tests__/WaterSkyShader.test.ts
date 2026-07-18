/**
 * Smoke tests for the improved water (transparent voxel) and sky shader
 * strings built by the MaterialSystem. Verifies the assembled WGSL is non-empty
 * and contains the expected tokens for the demo features.
 */

import { describe, it, expect } from 'vitest';
import { MaterialSystem } from '../MaterialSystem.js';

describe('TRANSPARENT_VOXEL (water) shader smoke', () => {
  it('vertex and fragment shaders are non-empty', () => {
    expect(MaterialSystem.TRANSPARENT_VOXEL.vertexShader.length).toBeGreaterThan(0);
    expect(MaterialSystem.TRANSPARENT_VOXEL.fragmentShader.length).toBeGreaterThan(0);
  });

  it('vertex shader contains ripple displacement driven by water.time + waveAmplitude', () => {
    const vs = MaterialSystem.TRANSPARENT_VOXEL.vertexShader;
    expect(vs).toContain('WaterVertexOutput');
    expect(vs).toContain('water.time');
    expect(vs).toContain('water.waveAmplitude');
    expect(vs).toContain('sin(');
    expect(vs).toContain('cos(');
    expect(vs).toContain('WATER_ID_U32');
  });

  it('fragment shader contains fresnel edge brightening + UV scroll + water color', () => {
    const fs = MaterialSystem.TRANSPARENT_VOXEL.fragmentShader;
    expect(fs).toContain('waterSurfaceColor');
    expect(fs).toContain('waterSurfaceAlpha');
    expect(fs).toContain('fresnel');
    expect(fs).toContain('water.waterColor');
    expect(fs).toContain('water.time');
    expect(fs).toContain('scrollUv');
  });

  it('declares the WaterUniform struct and water binding at group 1 binding 2', () => {
    const fs = MaterialSystem.TRANSPARENT_VOXEL.fragmentShader;
    expect(fs).toContain('struct WaterUniform');
    expect(fs).toContain('waterColor');
    expect(fs).toContain('waterDepth');
    expect(fs).toContain('waveAmplitude');
    expect(fs).toContain('@group(1) @binding(2) var<uniform> water : WaterUniform;');
  });

  it('still applies fog and sun lighting', () => {
    const fs = MaterialSystem.TRANSPARENT_VOXEL.fragmentShader;
    expect(fs).toContain('applyFog');
    expect(fs).toContain('sunLighting');
  });
});

describe('SKY shader smoke', () => {
  it('vertex and fragment shaders are non-empty', () => {
    expect(MaterialSystem.SKY.vertexShader.length).toBeGreaterThan(0);
    expect(MaterialSystem.SKY.fragmentShader.length).toBeGreaterThan(0);
  });

  it('fragment shader contains a sun-elevation gradient with day/night/sunset colors', () => {
    const fs = MaterialSystem.SKY.fragmentShader;
    expect(fs).toContain('sunHeight');
    expect(fs).toContain('dayFactor');
    expect(fs).toContain('zenithColor');
    expect(fs).toContain('horizonColor');
    expect(fs).toContain('nightColor');
    expect(fs).toContain('sunsetFactor');
  });

  it('fragment shader renders a sun disc', () => {
    const fs = MaterialSystem.SKY.fragmentShader;
    expect(fs).toContain('sunDisc');
    expect(fs).toContain('smoothstep');
    expect(fs).toContain('atmosphere.sunColor');
  });

  it('fragment shader renders hash-based stars visible at night', () => {
    const fs = MaterialSystem.SKY.fragmentShader;
    expect(fs).toContain('hash33');
    expect(fs).toContain('starThreshold');
    expect(fs).toContain('stars');
    expect(fs).toContain('1.0 - dayFactor');
  });

  it('uses atmosphere uniforms (sun direction, fog color) as inputs', () => {
    const fs = MaterialSystem.SKY.fragmentShader;
    expect(fs).toContain('atmosphere.sunDirection');
    expect(fs).toContain('atmosphere.fogColor');
  });
});
