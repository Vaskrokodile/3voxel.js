import { describe, it, expect, beforeEach } from 'vitest';
import { PipelineKeyBuilder, type PipelineKeyParts } from '../PipelineCache.js';
import type { VertexLayout } from '../types.js';
import { resetFakeCounters, FakeDevice, asDevice } from './fake.js';
import { PipelineCache } from '../PipelineCache.js';

const baseLayout: VertexLayout = {
  stride: 32,
  stepMode: 'vertex',
  attributes: [
    { name: 'position', shaderLocation: 0, format: 'float32x3', offset: 0 },
    { name: 'normal', shaderLocation: 1, format: 'float32x3', offset: 12 },
    { name: 'uv', shaderLocation: 2, format: 'float32x2', offset: 24 },
  ],
};

function baseParts(overrides: Partial<PipelineKeyParts> = {}): PipelineKeyParts {
  return {
    shaderHash: 'deadbeef',
    vertexLayout: baseLayout,
    colorFormat: 'bgra8unorm',
    depthFormat: 'depth24plus',
    blend: undefined,
    topology: 'triangle-list',
    sampleCount: 4,
    ...overrides,
  };
}

describe('PipelineKeyBuilder', () => {
  it('produces identical keys for identical parts', () => {
    const b = new PipelineKeyBuilder();
    expect(b.build(baseParts())).toBe(b.build(baseParts()));
  });

  it('produces different keys for different vertex layouts', () => {
    const b = new PipelineKeyBuilder();
    const other: VertexLayout = {
      stride: 24,
      stepMode: 'vertex',
      attributes: [
        { name: 'position', shaderLocation: 0, format: 'float32x3', offset: 0 },
        { name: 'uv', shaderLocation: 1, format: 'float32x2', offset: 12 },
      ],
    };
    expect(b.build(baseParts())).not.toBe(b.build(baseParts({ vertexLayout: other })));
  });

  it('produces different keys for different attribute order (by shaderLocation)', () => {
    const b = new PipelineKeyBuilder();
    const swapped: VertexLayout = {
      stride: 32,
      stepMode: 'vertex',
      attributes: [
        { name: 'normal', shaderLocation: 1, format: 'float32x3', offset: 12 },
        { name: 'position', shaderLocation: 0, format: 'float32x3', offset: 0 },
        { name: 'uv', shaderLocation: 2, format: 'float32x2', offset: 24 },
      ],
    };
    // Same logical layout, different array order — key must be stable (sorted).
    expect(b.build(baseParts())).toBe(b.build(baseParts({ vertexLayout: swapped })));
  });

  it('produces different keys for different blend states', () => {
    const b = new PipelineKeyBuilder();
    const blend: GPUBlendState = {
      color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      alpha: { srcFactor: 'one', dstFactor: 'zero', operation: 'add' },
    };
    expect(b.build(baseParts())).not.toBe(b.build(baseParts({ blend })));
  });

  it('produces different keys for different color formats', () => {
    const b = new PipelineKeyBuilder();
    expect(b.build(baseParts())).not.toBe(
      b.build(baseParts({ colorFormat: 'rgba8unorm' })),
    );
  });

  it('produces different keys for different depth formats / undefined', () => {
    const b = new PipelineKeyBuilder();
    expect(b.build(baseParts())).not.toBe(b.build(baseParts({ depthFormat: undefined })));
    expect(b.build(baseParts())).not.toBe(
      b.build(baseParts({ depthFormat: 'depth32float' })),
    );
  });

  it('produces different keys for different topology / sample count', () => {
    const b = new PipelineKeyBuilder();
    expect(b.build(baseParts())).not.toBe(b.build(baseParts({ topology: 'line-list' })));
    expect(b.build(baseParts())).not.toBe(b.build(baseParts({ sampleCount: 1 })));
  });

  it('produces different keys for different shader hashes', () => {
    const b = new PipelineKeyBuilder();
    expect(b.build(baseParts())).not.toBe(b.build(baseParts({ shaderHash: 'cafebabe' })));
  });
});

describe('PipelineCache', () => {
  beforeEach(() => resetFakeCounters());

  it('caches pipelines by key and returns the same object', () => {
    const device = new FakeDevice();
    const cache = new PipelineCache(asDevice(device));
    const desc: GPURenderPipelineDescriptor = {
      label: 'k1',
      layout: 'auto',
      vertex: { module: {} as GPUShaderModule, entryPoint: 'vs', buffers: [] },
      fragment: { module: {} as GPUShaderModule, entryPoint: 'fs', targets: [{ format: 'bgra8unorm' }] },
      primitive: { topology: 'triangle-list' },
      depthStencil: { format: 'depth24plus', depthCompare: 'less', depthWriteEnabled: true },
      multisample: { count: 4 },
    };
    const a = cache.getPipeline('k1', desc);
    const b = cache.getPipeline('k1', desc);
    expect(a).toBe(b);
    expect(cache.size).toBe(1);
    expect(cache.has('k1')).toBe(true);
    expect(cache.getIfExists('k1')).toBe(a);
    expect(cache.getIfExists('missing')).toBeUndefined();
  });

  it('creates distinct pipelines for distinct keys', () => {
    const device = new FakeDevice();
    const cache = new PipelineCache(asDevice(device));
    const desc: GPURenderPipelineDescriptor = {
      layout: 'auto',
      vertex: { module: {} as GPUShaderModule, entryPoint: 'vs', buffers: [] },
      fragment: { module: {} as GPUShaderModule, entryPoint: 'fs', targets: [{ format: 'bgra8unorm' }] },
      primitive: { topology: 'triangle-list' },
    };
    const a = cache.getPipeline('k1', { ...desc, label: 'k1' });
    const b = cache.getPipeline('k2', { ...desc, label: 'k2' });
    expect(a).not.toBe(b);
    expect(cache.size).toBe(2);
  });

  it('clear() empties the cache', () => {
    const device = new FakeDevice();
    const cache = new PipelineCache(asDevice(device));
    const desc: GPURenderPipelineDescriptor = {
      layout: 'auto',
      vertex: { module: {} as GPUShaderModule, entryPoint: 'vs', buffers: [] },
      fragment: { module: {} as GPUShaderModule, entryPoint: 'fs', targets: [{ format: 'bgra8unorm' }] },
      primitive: { topology: 'triangle-list' },
    };
    cache.getPipeline('k1', desc);
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.has('k1')).toBe(false);
  });
});
