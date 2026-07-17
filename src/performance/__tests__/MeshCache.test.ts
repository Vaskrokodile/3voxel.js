import { describe, expect, it } from 'vitest';
import { MeshCache } from '../MeshCache.js';
import type { CachedMesh } from '../MeshCache.js';

/**
 * Minimal fake GPUBuffer that records destroy() calls. Does NOT implement
 * the full GPUBuffer surface; it is cast to GPUBuffer via `as unknown as`
 * so the cache's `destroy()` calls can be tracked without pulling in the
 * full WebGPU type contract.
 */
class FakeBuffer {
  destroyed = false;
  readonly size: number;
  constructor(size = 0) {
    this.size = size;
  }
  destroy(): void {
    this.destroyed = true;
  }
}

/** Wrap a FakeBuffer so it satisfies the GPUBuffer type at the cache boundary. */
function gpuBuffer(b: FakeBuffer): GPUBuffer {
  return b as unknown as GPUBuffer;
}

/** Unwrap a cached GPUBuffer back to its FakeBuffer for assertion. */
function fakeOf(b: GPUBuffer): FakeBuffer {
  return b as unknown as FakeBuffer;
}

/** A trivial stand-in for GPUDevice (MeshCache only stores the reference). */
const fakeDevice: GPUDevice = ({} as unknown) as GPUDevice;

function makeMesh(): CachedMesh {
  return {
    vertexBuffer: gpuBuffer(new FakeBuffer(1024)),
    indexBuffer: gpuBuffer(new FakeBuffer(512)),
    indexFormat: 'uint16',
    opaqueCount: 36,
    transparentCount: 0,
    lastUsed: 0,
  };
}

describe('MeshCache', () => {
  it('set/get/has/delete round-trips a mesh', () => {
    const cache = new MeshCache(fakeDevice, 8);
    const mesh = makeMesh();
    cache.set('0,0,0', mesh, 1);
    expect(cache.has('0,0,0')).toBe(true);
    const got = cache.get('0,0,0', 2);
    expect(got).not.toBeNull();
    expect(got!.opaqueCount).toBe(36);
    expect(got!.lastUsed).toBe(2);
    expect(cache.size).toBe(1);
    cache.delete('0,0,0');
    expect(cache.has('0,0,0')).toBe(false);
    expect(cache.size).toBe(0);
  });

  it('get returns null for missing keys', () => {
    const cache = new MeshCache(fakeDevice, 8);
    expect(cache.get('nope', 0)).toBeNull();
  });

  it('set replaces an existing entry and destroys the old buffers', () => {
    const cache = new MeshCache(fakeDevice, 8);
    const first = makeMesh();
    cache.set('k', first, 1);
    const firstVb = first.vertexBuffer;
    const firstIb = first.indexBuffer;
    const second = makeMesh();
    cache.set('k', second, 2);
    expect(cache.size).toBe(1);
    expect(fakeOf(firstVb).destroyed).toBe(true);
    expect(fakeOf(firstIb).destroyed).toBe(true);
    expect(fakeOf(second.vertexBuffer).destroyed).toBe(false);
  });

  it('evicts least-recently-used meshes when exceeding max', () => {
    const cache = new MeshCache(fakeDevice, 3);
    const meshes: CachedMesh[] = [];
    // Insert 3 meshes with increasing lastUsed.
    for (let i = 0; i < 3; i++) {
      const m = makeMesh();
      meshes.push(m);
      cache.set(`k${i}`, m, i + 1);
    }
    expect(cache.size).toBe(3);
    // Touch k0 so it becomes most-recently-used; k1 is now oldest.
    cache.get('k0', 100);
    // Insert a 4th -> exceeds max by 1, evict should drop k1 (oldest).
    const fourth = makeMesh();
    cache.set('k3', fourth, 101);
    expect(cache.size).toBe(4);
    const evicted = cache.evict(101);
    expect(evicted).toBe(1);
    expect(cache.size).toBe(3);
    // k1 should be gone and its buffers destroyed.
    expect(cache.has('k1')).toBe(false);
    expect(fakeOf(meshes[1]!.vertexBuffer).destroyed).toBe(true);
    expect(fakeOf(meshes[1]!.indexBuffer).destroyed).toBe(true);
    // k0 (touched at frame 100) and k2/k3 (frame 101) survive.
    expect(cache.has('k0')).toBe(true);
    expect(cache.has('k2')).toBe(true);
    expect(cache.has('k3')).toBe(true);
  });

  it('evict is a no-op when under the cap', () => {
    const cache = new MeshCache(fakeDevice, 5);
    cache.set('a', makeMesh(), 1);
    expect(cache.evict(2)).toBe(0);
    expect(cache.size).toBe(1);
  });

  it('clear destroys all buffers and empties the cache', () => {
    const cache = new MeshCache(fakeDevice, 8);
    const a = makeMesh();
    const b = makeMesh();
    cache.set('a', a, 1);
    cache.set('b', b, 1);
    cache.clear();
    expect(cache.size).toBe(0);
    expect(fakeOf(a.vertexBuffer).destroyed).toBe(true);
    expect(fakeOf(b.vertexBuffer).destroyed).toBe(true);
  });

  it('does not evict entries touched in the current frame', () => {
    const cache = new MeshCache(fakeDevice, 2);
    const a = makeMesh();
    const b = makeMesh();
    cache.set('a', a, 5);
    cache.set('b', b, 5);
    // Both touched at frame 5; evict at frame 5 should skip them.
    const evicted = cache.evict(5);
    expect(evicted).toBe(0);
    expect(cache.size).toBe(2);
  });

  it('delete destroys the evicted buffer', () => {
    const cache = new MeshCache(fakeDevice, 8);
    const m = makeMesh();
    cache.set('x', m, 1);
    cache.delete('x');
    expect(fakeOf(m.vertexBuffer).destroyed).toBe(true);
    expect(fakeOf(m.indexBuffer).destroyed).toBe(true);
  });
});
