/**
 * Tests for the procedural TextureAtlas: registration, UV coordinates, GPU
 * upload, bind group entry, and sampler creation. Uses a concrete fake device.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  TextureAtlas,
  TextureAtlasError,
  registerBuiltinTextures,
} from '../TextureAtlas.js';
import {
  ShaderFakeDevice,
  asShaderDevice,
  resetShaderFakes,
  FakeTexture,
  FakeSampler,
} from './fake.js';

describe('TextureAtlas', () => {
  let device: GPUDevice;

  beforeEach(() => {
    resetShaderFakes();
    device = asShaderDevice(new ShaderFakeDevice());
  });

  it('has the default 256x256 atlas dimensions', () => {
    const atlas = new TextureAtlas(device);
    expect(atlas.width).toBe(256);
    expect(atlas.height).toBe(256);
    expect(atlas.capacity).toBe(256);
  });

  it('respects custom tile/row parameters', () => {
    const atlas = new TextureAtlas(device, 8, 4, 2);
    expect(atlas.width).toBe(32);
    expect(atlas.height).toBe(16);
    expect(atlas.capacity).toBe(8);
  });

  it('register returns a TextureEntry and getUV returns in-range UVs', () => {
    const atlas = new TextureAtlas(device);
    const entry = atlas.register('stone', () => [128, 128, 128, 255]);
    expect(entry.name).toBe('stone');
    expect(entry.x).toBe(0);
    expect(entry.y).toBe(0);
    expect(entry.width).toBe(1);
    expect(entry.height).toBe(1);

    const uv = atlas.getUV('stone');
    expect(uv).not.toBeNull();
    if (uv !== null) {
      expect(uv.u0).toBeGreaterThanOrEqual(0);
      expect(uv.u1).toBeLessThanOrEqual(1);
      expect(uv.v0).toBeGreaterThanOrEqual(0);
      expect(uv.v1).toBeLessThanOrEqual(1);
      expect(uv.u1).toBeGreaterThan(uv.u0);
      expect(uv.v1).toBeGreaterThan(uv.v0);
    }
  });

  it('getUV returns null for unregistered names', () => {
    const atlas = new TextureAtlas(device);
    expect(atlas.getUV('missing')).toBeNull();
  });

  it('throws when registering a duplicate name', () => {
    const atlas = new TextureAtlas(device);
    atlas.register('stone', () => [0, 0, 0, 255]);
    expect(() => atlas.register('stone', () => [0, 0, 0, 255])).toThrowError(TextureAtlasError);
  });

  it('throws when the atlas is full', () => {
    const atlas = new TextureAtlas(device, 4, 2, 1); // capacity 2
    atlas.register('a', () => [0, 0, 0, 255]);
    atlas.register('b', () => [0, 0, 0, 255]);
    expect(() => atlas.register('c', () => [0, 0, 0, 255])).toThrowError(TextureAtlasError);
  });

  it('allocates tiles left-to-right, top-to-bottom', () => {
    const atlas = new TextureAtlas(device, 4, 2, 2); // 2 cols, 2 rows
    const a = atlas.register('a', () => [0, 0, 0, 255]);
    const b = atlas.register('b', () => [0, 0, 0, 255]);
    const c = atlas.register('c', () => [0, 0, 0, 255]);
    expect(a.x).toBe(0);
    expect(a.y).toBe(0);
    expect(b.x).toBe(1);
    expect(b.y).toBe(0);
    expect(c.x).toBe(0);
    expect(c.y).toBe(1);
  });

  it('registerBuiltinTextures registers all 10 built-in textures', () => {
    const atlas = new TextureAtlas(device);
    const entries = registerBuiltinTextures(atlas);
    expect(entries.size).toBe(10);
    for (const name of [
      'stone', 'dirt', 'grass_top', 'grass_side', 'sand',
      'water', 'log_top', 'log_side', 'leaves', 'snow',
    ]) {
      expect(atlas.getUV(name)).not.toBeNull();
    }
  });

  it('upload creates a GPUTexture and writes pixel data once', () => {
    const atlas = new TextureAtlas(device);
    atlas.register('stone', () => [128, 128, 128, 255]);
    const tex = atlas.upload();
    const fakeTex = tex as unknown as FakeTexture;
    expect(fakeTex.descriptor.format).toBe('rgba8unorm');
    const size = fakeTex.descriptor.size as GPUExtent3DDict;
    expect(size.width).toBe(256);
    // The fake queue records a single writeTexture call.
    const queue = (device as unknown as { queue: { textureWrites: unknown[] } }).queue;
    expect(queue.textureWrites).toHaveLength(1);
    // Second upload reuses the same texture.
    const tex2 = atlas.upload();
    expect(tex2).toBe(tex);
  });

  it('getBindGroupEntry throws before upload', () => {
    const atlas = new TextureAtlas(device);
    expect(() => atlas.getBindGroupEntry(0)).toThrowError(TextureAtlasError);
  });

  it('getBindGroupEntry returns an entry with a texture view after upload', () => {
    const atlas = new TextureAtlas(device);
    atlas.register('stone', () => [128, 128, 128, 255]);
    atlas.upload();
    const entry = atlas.getBindGroupEntry(3);
    expect(entry.binding).toBe(3);
    expect(entry.resource).toBeDefined();
  });

  it('createSampler returns a sampler with linear filtering', () => {
    const atlas = new TextureAtlas(device);
    const sampler = atlas.createSampler();
    const fakeSampler = sampler as unknown as FakeSampler;
    expect(fakeSampler.descriptor.magFilter).toBe('linear');
    expect(fakeSampler.descriptor.minFilter).toBe('linear');
    expect(fakeSampler.descriptor.addressModeU).toBe('repeat');
  });

  it('dispose releases the GPU texture', () => {
    const atlas = new TextureAtlas(device);
    atlas.register('stone', () => [128, 128, 128, 255]);
    const tex = atlas.upload() as unknown as FakeTexture;
    expect(tex.destroyed).toBe(false);
    atlas.dispose();
    expect(tex.destroyed).toBe(true);
    // After dispose, upload creates a fresh texture.
    const tex2 = atlas.upload() as unknown as FakeTexture;
    expect(tex2).not.toBe(tex);
  });

  it('UVs for the second tile are offset from the first', () => {
    const atlas = new TextureAtlas(device, 16, 4, 1); // single row of 4
    atlas.register('a', () => [0, 0, 0, 255]);
    atlas.register('b', () => [0, 0, 0, 255]);
    const ua = atlas.getUV('a');
    const ub = atlas.getUV('b');
    expect(ua).not.toBeNull();
    expect(ub).not.toBeNull();
    if (ua !== null && ub !== null) {
      expect(ub.u0).toBeGreaterThan(ua.u0);
    }
  });
});
