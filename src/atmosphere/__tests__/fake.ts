/**
 * Extended fake GPU device for atmosphere tests.
 *
 * Supports the additional methods SkyRenderer needs beyond the renderer fake:
 * `createBindGroup` and pipeline `getBindGroupLayout`. Reuses the WebGPU
 * numeric-constant polyfill from the renderer test fake so the runtime globals
 * are installed before code under test runs.
 */

// Install WebGPU numeric constants (side-effect import).
import '../../renderer/__tests__/fake.js';

let bufferCounter = 0;
let bindGroupCounter = 0;
let bindGroupLayoutCounter = 0;
let shaderCounter = 0;
let pipelineCounter = 0;

/** Fake GPUBuffer recording size + usage. */
export class AtmFakeBuffer {
  public readonly id: number;
  public size: number;
  public usage: GPUBufferUsageFlags;
  public destroyed = false;
  public constructor(size: number, usage: GPUBufferUsageFlags) {
    this.id = ++bufferCounter;
    this.size = size;
    this.usage = usage;
  }
  public destroy(): void {
    this.destroyed = true;
  }
}

/** Fake shader module. */
export class AtmFakeShaderModule {
  public readonly id: number;
  public readonly source: string;
  public constructor(source: string) {
    this.id = ++shaderCounter;
    this.source = source;
  }
}

/** Fake bind group layout. */
export class AtmFakeBindGroupLayout {
  public readonly id: number;
  public constructor() {
    this.id = ++bindGroupLayoutCounter;
  }
}

/** Fake bind group. */
export class AtmFakeBindGroup {
  public readonly id: number;
  public constructor() {
    this.id = ++bindGroupCounter;
  }
}

/** Fake render pipeline supporting getBindGroupLayout. */
export class AtmFakePipeline {
  public readonly id: number;
  public readonly label: string;
  private readonly layouts: AtmFakeBindGroupLayout[];
  public constructor(label: string) {
    this.id = ++pipelineCounter;
    this.label = label;
    this.layouts = [new AtmFakeBindGroupLayout(), new AtmFakeBindGroupLayout()];
  }
  public getBindGroupLayout(index: number): AtmFakeBindGroupLayout {
    return this.layouts[index] ?? new AtmFakeBindGroupLayout();
  }
}

/** Fake queue recording writeBuffer calls. */
export class AtmFakeQueue {
  public readonly writes: { buffer: GPUBuffer; offset: number; data: BufferSource }[] = [];
  public writeBuffer(buffer: GPUBuffer, offset: number, data: BufferSource): void {
    this.writes.push({ buffer, offset, data });
  }
  public submit(_buffers: GPUCommandBuffer[]): void {
    // no-op
  }
}

/**
 * Fake device implementing all methods SkyRenderer calls: createBuffer,
 * createShaderModule, createRenderPipeline, createBindGroup, and a queue.
 */
export class AtmFakeDevice {
  public readonly queue: AtmFakeQueue;
  public constructor() {
    this.queue = new AtmFakeQueue();
  }

  public createBuffer(descriptor: GPUBufferDescriptor): GPUBuffer {
    return new AtmFakeBuffer(descriptor.size, descriptor.usage) as unknown as GPUBuffer;
  }

  public createShaderModule(descriptor: GPUShaderModuleDescriptor): GPUShaderModule {
    return new AtmFakeShaderModule(descriptor.code) as unknown as GPUShaderModule;
  }

  public createRenderPipeline(descriptor: GPURenderPipelineDescriptor): GPURenderPipeline {
    return new AtmFakePipeline(descriptor.label ?? '') as unknown as GPURenderPipeline;
  }

  public createBindGroup(_descriptor: GPUBindGroupDescriptor): GPUBindGroup {
    return new AtmFakeBindGroup() as unknown as GPUBindGroup;
  }
}

/** Present an {@link AtmFakeDevice} as a `GPUDevice` (test-only bridge). */
export function asDevice(d: AtmFakeDevice): GPUDevice {
  return d as unknown as GPUDevice;
}

/** Present an {@link AtmFakeQueue} as a `GPUQueue` (test-only bridge). */
export function asQueue(q: AtmFakeQueue): GPUQueue {
  return q as unknown as GPUQueue;
}

/** Cast a GPUBuffer to its fake for inspection. */
export function asFakeBuffer(b: GPUBuffer): AtmFakeBuffer {
  return b as unknown as AtmFakeBuffer;
}

/** Reset all fake counters (call in beforeEach for deterministic ids). */
export function resetAtmFakeCounters(): void {
  bufferCounter = 0;
  bindGroupCounter = 0;
  bindGroupLayoutCounter = 0;
  shaderCounter = 0;
  pipelineCounter = 0;
}
