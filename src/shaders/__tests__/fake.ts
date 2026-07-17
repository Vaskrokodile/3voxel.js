/**
 * Shared fake GPU device for shader-subsystem tests.
 *
 * Extends the renderer test fake with the texture/sampler/bind-group methods
 * that {@link TextureAtlas} calls. Concrete classes, no `any`.
 */

// --- WebGPU runtime-global polyfill (mirrors renderer/__tests__/fake.ts) ---
const __g = globalThis as unknown as Record<string, Record<string, number>>;
if (__g.GPUBufferUsage === undefined) {
  __g.GPUBufferUsage = {
    MAP_READ: 0x0001, MAP_WRITE: 0x0002, COPY_SRC: 0x0004, COPY_DST: 0x0008,
    INDEX: 0x0010, VERTEX: 0x0020, UNIFORM: 0x0040, STORAGE: 0x0080,
    INDIRECT: 0x0100, QUERY_RESOLVE: 0x0200,
  };
}
if (__g.GPUTextureUsage === undefined) {
  __g.GPUTextureUsage = {
    COPY_SRC: 0x01, COPY_DST: 0x02, TEXTURE_BINDING: 0x04,
    STORAGE_BINDING: 0x08, RENDER_ATTACHMENT: 0x10,
  };
}

let textureCounter = 0;
let samplerCounter = 0;
let viewCounter = 0;

/** Fake GPUTexture that records its descriptor. */
export class FakeTexture {
  public readonly id: number;
  public readonly descriptor: GPUTextureDescriptor;
  public destroyed = false;
  public constructor(descriptor: GPUTextureDescriptor) {
    this.id = ++textureCounter;
    this.descriptor = descriptor;
  }
  public createView(): GPUTextureView {
    return new FakeTextureView(this) as unknown as GPUTextureView;
  }
  public destroy(): void {
    this.destroyed = true;
  }
}

/** Fake GPUTextureView carrying a back-reference to its texture. */
export class FakeTextureView {
  public readonly id: number;
  public readonly texture: FakeTexture;
  public constructor(texture: FakeTexture) {
    this.id = ++viewCounter;
    this.texture = texture;
  }
}

/** Fake GPUSampler recording its descriptor. */
export class FakeSampler {
  public readonly id: number;
  public readonly descriptor: GPUSamplerDescriptor;
  public constructor(descriptor: GPUSamplerDescriptor) {
    this.id = ++samplerCounter;
    this.descriptor = descriptor;
  }
}

/** Fake queue recording writeTexture calls. */
export class ShaderFakeQueue {
  public readonly textureWrites: {
    destination: GPUImageCopyTexture;
    data: BufferSource;
    dataLayout: GPUImageDataLayout;
    size: GPUExtent3D;
  }[] = [];
  public writeTexture(
    destination: GPUImageCopyTexture,
    data: BufferSource,
    dataLayout: GPUImageDataLayout,
    size: GPUExtent3D,
  ): void {
    this.textureWrites.push({ destination, data, dataLayout, size });
  }
}

/**
 * Fake device implementing the methods {@link TextureAtlas} uses:
 * `createTexture`, `createSampler`, and `queue.writeTexture`.
 */
export class ShaderFakeDevice {
  public readonly queue: ShaderFakeQueue;
  public constructor() {
    this.queue = new ShaderFakeQueue();
  }
  public createTexture(descriptor: GPUTextureDescriptor): GPUTexture {
    return new FakeTexture(descriptor) as unknown as GPUTexture;
  }
  public createSampler(descriptor: GPUSamplerDescriptor): GPUSampler {
    return new FakeSampler(descriptor) as unknown as GPUSampler;
  }
}

/** Reset fake counters (call in beforeEach for deterministic ids). */
export function resetShaderFakes(): void {
  textureCounter = 0;
  samplerCounter = 0;
  viewCounter = 0;
}

/** Present a {@link ShaderFakeDevice} as a `GPUDevice` (test-only bridge). */
export function asShaderDevice(d: ShaderFakeDevice): GPUDevice {
  return d as unknown as GPUDevice;
}
