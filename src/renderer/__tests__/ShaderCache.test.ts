import { describe, it, expect, beforeEach } from 'vitest';
import { ShaderCache } from '../ShaderCache.js';
import { FakeDevice, FakeShaderModule, asDevice, resetFakeCounters } from './fake.js';

describe('ShaderCache', () => {
  beforeEach(() => resetFakeCounters());

  it('returns the same module object for identical source', () => {
    const device = new FakeDevice();
    const cache = new ShaderCache(asDevice(device));
    const src = '@vertex fn vs() {}';
    const a = cache.getShader(src);
    const b = cache.getShader(src);
    expect(a).toBe(b);
    expect(cache.size).toBe(1);
  });

  it('returns the same module for equal-content different-instance strings', () => {
    const device = new FakeDevice();
    const cache = new ShaderCache(asDevice(device));
    const a = cache.getShader('fn foo() {}');
    const b = cache.getShader('fn foo() {}');
    expect(a).toBe(b);
    expect(cache.size).toBe(1);
  });

  it('returns distinct modules for different source', () => {
    const device = new FakeDevice();
    const cache = new ShaderCache(asDevice(device));
    const a = cache.getShader('fn a() {}');
    const b = cache.getShader('fn b() {}');
    expect(a).not.toBe(b);
    expect(cache.size).toBe(2);
  });

  it('produces a module wrapping the source (fake)', () => {
    const device = new FakeDevice();
    const cache = new ShaderCache(asDevice(device));
    const mod = cache.getShader('fn x() {}') as unknown as FakeShaderModule;
    expect(mod.source).toBe('fn x() {}');
  });

  it('clear() empties the cache', () => {
    const device = new FakeDevice();
    const cache = new ShaderCache(asDevice(device));
    cache.getShader('fn a() {}');
    cache.clear();
    expect(cache.size).toBe(0);
  });
});
