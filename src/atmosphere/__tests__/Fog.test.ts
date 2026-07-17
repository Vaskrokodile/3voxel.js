import { describe, it, expect } from 'vitest';
import { Fog, fogWgslSnippet } from '../Fog.js';

describe('Fog.factor', () => {
  it('returns 0 when distance is below near', () => {
    const fog = new Fog({ near: 10, far: 50, color: { x: 0.5, y: 0.6, z: 0.7 } });
    expect(fog.factor(0)).toBe(0);
    expect(fog.factor(5)).toBe(0);
    expect(fog.factor(9.99)).toBe(0);
  });

  it('returns 1 when distance is above far', () => {
    const fog = new Fog({ near: 10, far: 50, color: { x: 0.5, y: 0.6, z: 0.7 } });
    expect(fog.factor(50)).toBe(1);
    expect(fog.factor(100)).toBe(1);
    expect(fog.factor(1000)).toBe(1);
  });

  it('returns 0.5 at the midpoint', () => {
    const fog = new Fog({ near: 10, far: 50, color: { x: 0.5, y: 0.6, z: 0.7 } });
    expect(fog.factor(30)).toBeCloseTo(0.5);
  });

  it('interpolates linearly', () => {
    const fog = new Fog({ near: 0, far: 100, color: { x: 0, y: 0, z: 0 } });
    expect(fog.factor(25)).toBeCloseTo(0.25);
    expect(fog.factor(75)).toBeCloseTo(0.75);
  });

  it('handles near === far (degenerate range)', () => {
    const fog = new Fog({ near: 20, far: 20, color: { x: 0, y: 0, z: 0 } });
    expect(fog.factor(10)).toBe(0);
    expect(fog.factor(20)).toBe(1);
    expect(fog.factor(30)).toBe(1);
  });
});

describe('fogWgslSnippet', () => {
  it('bakes near, far, and color as literals', () => {
    const fog = new Fog({ near: 12, far: 48, color: { x: 0.6, y: 0.7, z: 0.9 } });
    const src = fogWgslSnippet(fog);
    expect(src).toContain('12.0');
    expect(src).toContain('48.0');
    expect(src).toContain('0.6');
    expect(src).toContain('0.7');
    expect(src).toContain('0.9');
    expect(src).toContain('fn applyFog(');
    expect(src).toContain('mix(');
  });

  it('produces valid WGSL with correct structure', () => {
    const fog = new Fog({ near: 10, far: 50, color: { x: 0.5, y: 0.6, z: 0.7 } });
    const src = fogWgslSnippet(fog);
    expect(src).toMatch(/fn applyFog\(color: vec3<f32>, worldPos: vec3<f32>, cameraPos: vec3<f32>\) -> vec3<f32>/);
    expect(src).toContain('distance(worldPos, cameraPos)');
    expect(src).toContain('clamp(');
  });
});
