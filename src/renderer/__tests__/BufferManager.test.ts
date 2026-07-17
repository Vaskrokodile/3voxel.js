import { describe, it, expect, beforeEach } from 'vitest';
import { BufferManager, roundUp16 } from '../BufferManager.js';
import { FakeDevice, FakeBuffer, asDevice, resetFakeCounters } from './fake.js';

describe('roundUp16', () => {
  it('rounds up to the next multiple of 16', () => {
    expect(roundUp16(0)).toBe(0);
    expect(roundUp16(1)).toBe(16);
    expect(roundUp16(15)).toBe(16);
    expect(roundUp16(16)).toBe(16);
    expect(roundUp16(17)).toBe(32);
    expect(roundUp16(224)).toBe(224);
  });
});

describe('BufferManager.bytesAllocated', () => {
  beforeEach(() => resetFakeCounters());

  it('accounts for uploaded buffers (rounded up to 16)', () => {
    const device = new FakeDevice();
    const mgr = new BufferManager(asDevice(device));
    expect(mgr.bytesAllocated).toBe(0);

    const data = new Uint8Array(100);
    const buf = mgr.upload(data, GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST);
    expect(mgr.bytesAllocated).toBe(roundUp16(100));
    expect((buf as unknown as FakeBuffer).size).toBe(roundUp16(100));
  });

  it('accounts for uniform buffers', () => {
    const device = new FakeDevice();
    const mgr = new BufferManager(asDevice(device));
    const a = mgr.createUniformBuffer(48);
    expect(mgr.bytesAllocated).toBe(roundUp16(48));
    expect((a as unknown as FakeBuffer).size).toBe(roundUp16(48));
  });

  it('reuses pooled uniform buffers without growing allocation', () => {
    const device = new FakeDevice();
    const mgr = new BufferManager(asDevice(device));
    const size = 64; // a pooled size
    const a = mgr.createUniformBuffer(size);
    const allocatedAfterCreate = mgr.bytesAllocated;
    mgr.releaseUniformBuffer(a);

    // Releasing to the pool does NOT decrement accounting (buffer still live).
    expect(mgr.bytesAllocated).toBe(allocatedAfterCreate);

    const b = mgr.createUniformBuffer(size);
    // Should reuse the pooled buffer (same object) and not allocate new bytes.
    expect(b).toBe(a);
    expect(mgr.bytesAllocated).toBe(allocatedAfterCreate);
  });

  it('destroy() decrements accounting', () => {
    const device = new FakeDevice();
    const mgr = new BufferManager(asDevice(device));
    const buf = mgr.upload(new Uint8Array(32), GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST);
    const before = mgr.bytesAllocated;
    mgr.destroy(buf);
    expect(mgr.bytesAllocated).toBe(before - roundUp16(32));
  });

  it('dispose() clears pools and accounting', () => {
    const device = new FakeDevice();
    const mgr = new BufferManager(asDevice(device));
    const a = mgr.createUniformBuffer(64);
    const b = mgr.createUniformBuffer(128);
    mgr.releaseUniformBuffer(a);
    mgr.releaseUniformBuffer(b);
    expect(mgr.bytesAllocated).toBeGreaterThan(0);
    mgr.dispose();
    expect(mgr.bytesAllocated).toBe(0);
  });

  it('upload writes data through the queue', () => {
    const device = new FakeDevice();
    const mgr = new BufferManager(asDevice(device));
    const data = new Uint8Array([1, 2, 3, 4, 5]);
    mgr.upload(data, GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST);
    expect(device.queue.writes).toHaveLength(1);
  });
});
