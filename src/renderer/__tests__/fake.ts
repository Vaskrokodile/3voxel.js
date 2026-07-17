/**
 * Minimal fake GPU device for unit tests.
 *
 * Implements only the methods the renderer calls in pure-logic tests. This is a
 * concrete class (no `any`): each method returns a small stub object shaped to
 * satisfy the type the renderer reads back. We do NOT attempt to emulate a
 * real WebGPU device — tests only exercise cache/key/offset/accounting logic.
 */

// --- WebGPU runtime-global polyfill for the Node test environment ----------
// `@webgpu/types` ships *types only*; the `GPUBufferUsage` / `GPUTextureUsage`
// numeric constants exist as runtime globals in browsers but not under Node.
// The renderer references them at runtime (e.g. `GPUBufferUsage.UNIFORM`), so
// we install the standard WebGPU numeric values here. This file is imported by
// every test, so the polyfill is in place before any code under test runs.
const __g = globalThis as unknown as Record<string, Record<string, number>>;
if (__g.GPUBufferUsage === undefined) {
  __g.GPUBufferUsage = {
    MAP_READ: 0x0001,
    MAP_WRITE: 0x0002,
    COPY_SRC: 0x0004,
    COPY_DST: 0x0008,
    INDEX: 0x0010,
    VERTEX: 0x0020,
    UNIFORM: 0x0040,
    STORAGE: 0x0080,
    INDIRECT: 0x0100,
    QUERY_RESOLVE: 0x0200,
  };
}
if (__g.GPUTextureUsage === undefined) {
  __g.GPUTextureUsage = {
    COPY_SRC: 0x01,
    COPY_DST: 0x02,
    TEXTURE_BINDING: 0x04,
    STORAGE_BINDING: 0x08,
    RENDER_ATTACHMENT: 0x10,
  };
}

let shaderModuleCounter = 0;
let pipelineCounter = 0;
let bufferCounter = 0;

/** A fake compiled shader module carrying its source for identity checks. */
export class FakeShaderModule {
  public readonly id: number;
  public readonly source: string;
  public constructor(source: string) {
    this.id = ++shaderModuleCounter;
    this.source = source;
  }
}

/** A fake render pipeline carrying its label (the cache key). */
export class FakePipeline {
  public readonly id: number;
  public readonly label: string;
  public constructor(label: string) {
    this.id = ++pipelineCounter;
    this.label = label;
  }
}

/** A fake GPUBuffer that records its size for accounting tests. */
export class FakeBuffer {
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

/**
 * Fake device. Implements `createShaderModule`, `createRenderPipeline`,
 * `createBuffer`, and exposes a `queue` stub with `writeBuffer`/`submit`.
 */
export class FakeDevice {
  public readonly queue: FakeQueue;
  public constructor() {
    this.queue = new FakeQueue();
  }

  public createShaderModule(descriptor: GPUShaderModuleDescriptor): GPUShaderModule {
    return new FakeShaderModule(descriptor.code) as unknown as GPUShaderModule;
  }

  public createRenderPipeline(descriptor: GPURenderPipelineDescriptor): GPURenderPipeline {
    return new FakePipeline(descriptor.label ?? '') as unknown as GPURenderPipeline;
  }

  public createBuffer(descriptor: GPUBufferDescriptor): GPUBuffer {
    return new FakeBuffer(descriptor.size, descriptor.usage) as unknown as GPUBuffer;
  }
}

/** Fake queue that just records writes/submits for inspection. */
export class FakeQueue {
  public readonly writes: { buffer: GPUBuffer; offset: number; data: BufferSource }[] = [];
  public readonly submissions: GPUCommandBuffer[] = [];
  public writeBuffer(buffer: GPUBuffer, offset: number, data: BufferSource): void {
    this.writes.push({ buffer, offset, data });
  }
  public submit(buffers: GPUCommandBuffer[]): void {
    this.submissions.push(...buffers);
  }
}

/** Reset all fake counters (call in beforeEach for deterministic ids). */
export function resetFakeCounters(): void {
  shaderModuleCounter = 0;
  pipelineCounter = 0;
  bufferCounter = 0;
}

/**
 * Present a `FakeDevice` as a `GPUDevice` to the code under test.
 *
 * `FakeDevice` only implements the handful of methods the renderer calls in
 * pure-logic tests; it is not structurally compatible with the full
 * `GPUDevice` interface (which has a `__brand` and many surface members), so
 * we use a type assertion rather than `implements`. This is a test-only
 * bridge — no `any` is used.
 */
export function asDevice(d: FakeDevice): GPUDevice {
  return d as unknown as GPUDevice;
}

/** Present a `FakeQueue` as a `GPUQueue` (test-only, same rationale as above). */
export function asQueue(q: FakeQueue): GPUQueue {
  return q as unknown as GPUQueue;
}
