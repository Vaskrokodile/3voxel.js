import { describe, it, expect } from 'vitest';
import type { Mat4, AABB } from '../../core/types.js';
import {
  GPUCuller,
  extractFrustumPlanes,
  CHUNK_BUFFER_STRIDE,
  DRAW_BUFFER_STRIDE,
  FRUSTUM_UNIFORM_SIZE,
  BUFFER_USAGE,
} from '../GPUCulling.js';
import type { GPUChunkData } from '../GPUCulling.js';

// ---------------------------------------------------------------------------
// Fakes — concrete classes, no `any`. Cast to WebGPU types at the call site
// with `as unknown as GPUDevice` (the cast uses `unknown`, not `any`).
// ---------------------------------------------------------------------------

interface FakeBufferRecord {
  readonly label: string;
  readonly size: number;
  readonly usage: number;
  destroyed: boolean;
}

class FakeBuffer implements FakeBufferRecord {
  readonly label: string;
  readonly size: number;
  readonly usage: number;
  destroyed = false;
  constructor(desc: GPUBufferDescriptor) {
    this.label = desc.label ?? '';
    this.size = desc.size;
    this.usage = desc.usage;
  }
  destroy(): void {
    this.destroyed = true;
  }
}

class FakeShaderModule {
  readonly label: string;
  readonly code: string;
  constructor(desc: GPUShaderModuleDescriptor) {
    this.label = desc.label ?? '';
    this.code = desc.code;
  }
}

class FakeBindGroupLayout {
  readonly label: string;
  constructor(desc: GPUBindGroupLayoutDescriptor) {
    this.label = desc.label ?? '';
  }
}

class FakeComputePipeline {
  readonly label: string;
  readonly code: string;
  private readonly layout: FakeBindGroupLayout;
  constructor(desc: GPUComputePipelineDescriptor) {
    this.label = desc.label ?? '';
    const module = desc.compute.module as unknown as FakeShaderModule;
    this.code = module.code;
    this.layout = new FakeBindGroupLayout({ label: 'auto', entries: [] });
  }
  getBindGroupLayout(_index: number): FakeBindGroupLayout {
    return this.layout;
  }
}

class FakeBindGroup {
  readonly label: string;
  constructor(desc: GPUBindGroupDescriptor) {
    this.label = desc.label ?? '';
  }
}

interface WriteBufferCall {
  readonly buffer: FakeBuffer;
  readonly offset: number;
  readonly data: Float32Array;
}

class FakeQueue {
  readonly writeBufferCalls: WriteBufferCall[] = [];
  writeBuffer(
    buffer: GPUBuffer,
    offset: number,
    data: Float32Array,
  ): void {
    this.writeBufferCalls.push({
      buffer: buffer as unknown as FakeBuffer,
      offset,
      data: data.slice(),
    });
  }
}

class FakeDevice {
  readonly queue: FakeQueue = new FakeQueue();
  readonly createdBuffers: FakeBuffer[] = [];

  createBuffer(desc: GPUBufferDescriptor): FakeBuffer {
    const buf = new FakeBuffer(desc);
    this.createdBuffers.push(buf);
    return buf;
  }
  createShaderModule(desc: GPUShaderModuleDescriptor): FakeShaderModule {
    return new FakeShaderModule(desc);
  }
  createComputePipeline(desc: GPUComputePipelineDescriptor): FakeComputePipeline {
    return new FakeComputePipeline(desc);
  }
  createBindGroup(desc: GPUBindGroupDescriptor): FakeBindGroup {
    return new FakeBindGroup(desc);
  }
}

/** Minimal fake command encoder that records compute-pass begins. */
class FakeCommandEncoder {
  computePasses = 0;
  beginComputePass(_desc: GPUComputePassDescriptor): FakeComputePass {
    this.computePasses += 1;
    return new FakeComputePass();
  }
}

class FakeComputePass {
  pipelineSet = false;
  bindGroupSet = false;
  dispatchCount = 0;
  ended = false;
  setPipeline(_p: GPUComputePipeline): void {
    this.pipelineSet = true;
  }
  setBindGroup(_index: number, _bg: GPUBindGroup): void {
    this.bindGroupSet = true;
  }
  dispatchWorkgroups(count: number): void {
    this.dispatchCount = count;
  }
  end(): void {
    this.ended = true;
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

function makeMat4(values: number[]): Mat4 {
  return { m: new Float32Array(values) };
}

const IDENTITY_MAT4: number[] = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

describe('extractFrustumPlanes', () => {
  it('returns 24 floats (6 planes × 4 components)', () => {
    const planes = extractFrustumPlanes(makeMat4(IDENTITY_MAT4));
    expect(planes.length).toBe(24);
  });

  it('produces finite normals and w for an identity matrix', () => {
    const planes = extractFrustumPlanes(makeMat4(IDENTITY_MAT4));
    for (let i = 0; i < 24; i++) {
      expect(Number.isFinite(planes[i])).toBe(true);
    }
  });

  it('normalizes plane normals to unit length', () => {
    const planes = extractFrustumPlanes(makeMat4(IDENTITY_MAT4));
    for (let p = 0; p < 6; p++) {
      const nx = planes[p * 4 + 0]!;
      const ny = planes[p * 4 + 1]!;
      const nz = planes[p * 4 + 2]!;
      const len = Math.hypot(nx, ny, nz);
      expect(len).toBeCloseTo(1, 5);
    }
  });

  it('extracts expected planes from the identity matrix', () => {
    const planes = extractFrustumPlanes(makeMat4(IDENTITY_MAT4));
    // left  = row4+row1 = (1,0,0,1)
    expect(planes[0]).toBeCloseTo(1, 6);
    expect(planes[1]).toBeCloseTo(0, 6);
    expect(planes[2]).toBeCloseTo(0, 6);
    expect(planes[3]).toBeCloseTo(1, 6);
    // near  = row3 = (0,0,1,0)
    expect(planes[16]).toBeCloseTo(0, 6);
    expect(planes[17]).toBeCloseTo(0, 6);
    expect(planes[18]).toBeCloseTo(1, 6);
    expect(planes[19]).toBeCloseTo(0, 6);
  });
});

describe('GPUCuller', () => {
  const MAX_CHUNKS = 4;

  function makeCuller(): { culler: GPUCuller; device: FakeDevice } {
    const device = new FakeDevice();
    const culler = new GPUCuller(device as unknown as GPUDevice, MAX_CHUNKS);
    return { culler, device };
  }

  it('creates buffers with correct sizes and usages', () => {
    const { device } = makeCuller();
    // 3 buffers: input, output, uniform.
    expect(device.createdBuffers.length).toBe(3);

    const input = device.createdBuffers[0]!;
    const output = device.createdBuffers[1]!;
    const uniform = device.createdBuffers[2]!;

    expect(input.size).toBe(MAX_CHUNKS * CHUNK_BUFFER_STRIDE);
    expect(input.usage & BUFFER_USAGE.STORAGE).toBeTruthy();
    expect(input.usage & BUFFER_USAGE.COPY_DST).toBeTruthy();

    expect(output.size).toBe(MAX_CHUNKS * DRAW_BUFFER_STRIDE);
    expect(output.usage & BUFFER_USAGE.STORAGE).toBeTruthy();
    expect(output.usage & BUFFER_USAGE.INDIRECT).toBeTruthy();

    expect(uniform.size).toBe(FRUSTUM_UNIFORM_SIZE);
    expect(uniform.usage & BUFFER_USAGE.UNIFORM).toBeTruthy();
    expect(uniform.usage & BUFFER_USAGE.COPY_DST).toBeTruthy();
  });

  it('writeChunkData uploads to the input buffer at offset 0', () => {
    const { culler, device } = makeCuller();
    const chunks: GPUChunkData[] = [
      {
        aabb: { min: { x: 0, y: 0, z: 0 }, max: { x: 16, y: 16, z: 16 } },
        draw: { indexCount: 100, instanceCount: 1, firstIndex: 0, vertexOffset: 0, firstInstance: 0 },
      },
    ];
    culler.writeChunkData(chunks);

    // The first writeBuffer call targets the input buffer (created first).
    const call = device.queue.writeBufferCalls[0]!;
    expect(call.buffer).toBe(device.createdBuffers[0]!);
    expect(call.offset).toBe(0);
  });

  it('writeChunkData writes AABB and draw args at correct offsets', () => {
    const { culler, device } = makeCuller();
    const chunks: GPUChunkData[] = [
      {
        aabb: { min: { x: 1, y: 2, z: 3 }, max: { x: 17, y: 18, z: 19 } },
        draw: { indexCount: 42, instanceCount: 7, firstIndex: 3, vertexOffset: 11, firstInstance: 5 },
      },
    ];
    culler.writeChunkData(chunks);

    const data = device.queue.writeBufferCalls[0]!.data;
    const floats = data;
    const uints = new Uint32Array(data.buffer);

    // Per-chunk stride is 12 float32 slots (48 bytes).
    const stride = CHUNK_BUFFER_STRIDE / 4;

    // min (slots 0..2)
    expect(floats[0]).toBeCloseTo(1, 6);
    expect(floats[1]).toBeCloseTo(2, 6);
    expect(floats[2]).toBeCloseTo(3, 6);
    // pad (slot 3)
    expect(floats[3]).toBe(0);
    // max (slots 4..6)
    expect(floats[4]).toBeCloseTo(17, 6);
    expect(floats[5]).toBeCloseTo(18, 6);
    expect(floats[6]).toBeCloseTo(19, 6);
    // draw args (slots 7..11 as uint32)
    expect(uints[7]).toBe(42);
    expect(uints[8]).toBe(7);
    expect(uints[9]).toBe(3);
    expect(uints[10]).toBe(11);
    expect(uints[11]).toBe(5);

    // Second chunk slot is zeroed (no second chunk written).
    expect(floats[stride + 0]).toBe(0);
  });

  it('writeChunkData writes multiple chunks at stride offsets', () => {
    const { culler, device } = makeCuller();
    const chunks: GPUChunkData[] = [
      {
        aabb: { min: { x: 0, y: 0, z: 0 }, max: { x: 16, y: 16, z: 16 } },
        draw: { indexCount: 10, instanceCount: 1, firstIndex: 0, vertexOffset: 0, firstInstance: 0 },
      },
      {
        aabb: { min: { x: 16, y: 0, z: 0 }, max: { x: 32, y: 16, z: 16 } },
        draw: { indexCount: 20, instanceCount: 2, firstIndex: 10, vertexOffset: 5, firstInstance: 1 },
      },
    ];
    culler.writeChunkData(chunks);

    const data = device.queue.writeBufferCalls[0]!.data;
    const uints = new Uint32Array(data.buffer);
    const stride = CHUNK_BUFFER_STRIDE / 4;

    // Chunk 1 min.x at slot stride+0.
    expect(data[stride + 0]).toBeCloseTo(16, 6);
    // Chunk 1 indexCount at slot stride+7.
    expect(uints[stride + 7]).toBe(20);
    expect(uints[stride + 8]).toBe(2);
  });

  it('throws when exceeding capacity', () => {
    const { culler } = makeCuller();
    const tooMany: GPUChunkData[] = Array.from({ length: MAX_CHUNKS + 1 }, () => ({
      aabb: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } },
      draw: { indexCount: 1, instanceCount: 1, firstIndex: 0, vertexOffset: 0, firstInstance: 0 },
    }));
    expect(() => culler.writeChunkData(tooMany)).toThrow(RangeError);
  });

  it('cull encodes a compute pass and returns the output buffer', () => {
    const { culler, device } = makeCuller();
    const chunks: GPUChunkData[] = [
      {
        aabb: { min: { x: 0, y: 0, z: 0 }, max: { x: 16, y: 16, z: 16 } },
        draw: { indexCount: 100, instanceCount: 1, firstIndex: 0, vertexOffset: 0, firstInstance: 0 },
      },
    ];
    culler.writeChunkData(chunks);

    const encoder = new FakeCommandEncoder();
    const result = culler.cull(
      makeMat4(IDENTITY_MAT4),
      encoder as unknown as GPUCommandEncoder,
    );

    // Returns the output buffer.
    expect(result).toBe(device.createdBuffers[1]!);
    // A compute pass was begun.
    expect(encoder.computePasses).toBe(1);

    // The uniform upload is the second writeBuffer call (after chunk data).
    const uniformWrite = device.queue.writeBufferCalls[1]!;
    expect(uniformWrite.buffer).toBe(device.createdBuffers[2]!);
    expect(uniformWrite.offset).toBe(0);
    // 44 floats.
    expect(uniformWrite.data.length).toBe(44);
    // chunkCount at slot 40 (byte 160).
    expect(uniformWrite.data[40]).toBe(1);
  });

  it('cull writes frustum planes into the uniform at slots 0..23', () => {
    const { culler, device } = makeCuller();
    culler.writeChunkData([
      {
        aabb: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } },
        draw: { indexCount: 1, instanceCount: 1, firstIndex: 0, vertexOffset: 0, firstInstance: 0 },
      },
    ]);
    const encoder = new FakeCommandEncoder();
    culler.cull(makeMat4(IDENTITY_MAT4), encoder as unknown as GPUCommandEncoder);

    const uniform = device.queue.writeBufferCalls[1]!.data;
    // Plane 0 (left) from identity = (1,0,0,1).
    expect(uniform[0]).toBeCloseTo(1, 6);
    expect(uniform[1]).toBeCloseTo(0, 6);
    expect(uniform[2]).toBeCloseTo(0, 6);
    expect(uniform[3]).toBeCloseTo(1, 6);
    // viewProj at slots 24..39 — identity m[0]=1.
    expect(uniform[24]).toBeCloseTo(1, 6);
  });

  it('destroy destroys all buffers', () => {
    const { culler, device } = makeCuller();
    culler.destroy();
    expect(device.createdBuffers.every((b) => b.destroyed)).toBe(true);
  });
});
