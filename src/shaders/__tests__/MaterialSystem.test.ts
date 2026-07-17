/**
 * Tests for the MaterialSystem: built-in materials exist, have valid shaders,
 * and register/get works for custom materials.
 */

import { describe, it, expect } from 'vitest';
import { MaterialSystem, type Material } from '../MaterialSystem.js';

describe('MaterialSystem', () => {
  it('exposes four built-in materials as static constants', () => {
    expect(MaterialSystem.OPAQUE_VOXEL.name).toBe('opaque_voxel');
    expect(MaterialSystem.TRANSPARENT_VOXEL.name).toBe('transparent_voxel');
    expect(MaterialSystem.WIREFRAME.name).toBe('wireframe');
    expect(MaterialSystem.SKY.name).toBe('sky');
  });

  it('built-in materials have non-empty vertex and fragment shaders', () => {
    for (const mat of [
      MaterialSystem.OPAQUE_VOXEL,
      MaterialSystem.TRANSPARENT_VOXEL,
      MaterialSystem.WIREFRAME,
      MaterialSystem.SKY,
    ]) {
      expect(mat.vertexShader.length).toBeGreaterThan(0);
      expect(mat.fragmentShader.length).toBeGreaterThan(0);
    }
  });

  it('opaque voxel shader contains vs_main and fs_main entry points', () => {
    expect(MaterialSystem.OPAQUE_VOXEL.vertexShader).toContain('@vertex fn vs_main');
    expect(MaterialSystem.OPAQUE_VOXEL.fragmentShader).toContain('@fragment fn fs_main');
  });

  it('opaque voxel fragment uses sunLighting, applyFog, and color table lookup', () => {
    const fs = MaterialSystem.OPAQUE_VOXEL.fragmentShader;
    expect(fs).toContain('sunLighting');
    expect(fs).toContain('applyFog');
    expect(fs).toContain('colorTable.colors');
  });

  it('transparent voxel fragment uses waterAlpha', () => {
    expect(MaterialSystem.TRANSPARENT_VOXEL.fragmentShader).toContain('waterAlpha');
  });

  it('opaque material has correct fixed-function state', () => {
    expect(MaterialSystem.OPAQUE_VOXEL.blendMode).toBe('opaque');
    expect(MaterialSystem.OPAQUE_VOXEL.depthWrite).toBe(true);
    expect(MaterialSystem.OPAQUE_VOXEL.cullMode).toBe('back');
  });

  it('transparent material has depthWrite=false and no culling', () => {
    expect(MaterialSystem.TRANSPARENT_VOXEL.blendMode).toBe('transparent');
    expect(MaterialSystem.TRANSPARENT_VOXEL.depthWrite).toBe(false);
    expect(MaterialSystem.TRANSPARENT_VOXEL.cullMode).toBe('none');
  });

  it('get() returns built-in materials by name', () => {
    expect(MaterialSystem.get('opaque_voxel')).toBe(MaterialSystem.OPAQUE_VOXEL);
    expect(MaterialSystem.get('sky')).toBe(MaterialSystem.SKY);
  });

  it('get() returns null for unknown names', () => {
    expect(MaterialSystem.get('nope')).toBeNull();
  });

  it('register() adds a custom material retrievable via get()', () => {
    const custom: Material = {
      name: 'custom_mat',
      vertexShader: '@vertex fn vs_main() {}',
      fragmentShader: '@fragment fn fs_main() {}',
      blendMode: 'additive',
      depthWrite: false,
      cullMode: 'front',
    };
    MaterialSystem.register('custom_mat', custom);
    expect(MaterialSystem.get('custom_mat')).toBe(custom);
  });

  it('opaque voxel vertex shader references camera.viewProj', () => {
    expect(MaterialSystem.OPAQUE_VOXEL.vertexShader).toContain('camera.viewProj');
  });
});
