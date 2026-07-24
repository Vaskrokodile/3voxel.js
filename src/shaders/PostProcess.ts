/**
 * Post-process chain: HDR scene target + separable bloom + ACES tone mapping.
 *
 * Phase 1 implementation of the engine's post-processing pipeline.
 *
 * Flow (per frame):
 *   1. The scene is rendered into {@link PostProcessChain.sceneColorView}
 *      (an offscreen `rgba16float` HDR target) by the renderer.
 *   2. {@link PostProcessChain.render} is called with the swapchain view; it
 *      records, in one command buffer:
 *        a. bright-pass  : scene (full) → bright (half res), luminance threshold.
 *        b. blur-H       : bright → blurH (half res), horizontal 9-tap Gaussian.
 *        c. blur-V       : blurH  → bloom (half res), vertical 9-tap Gaussian.
 *        d. tonemap      : scene (full) + bloom (half) → swapchain, ACES.
 *
 * All pipelines use `layout: 'auto'`; bind groups are rebuilt per frame (cheap,
 * and the swapchain view changes every frame anyway).
 */

/** A single fullscreen post-process stage (legacy interface, retained). */
export interface PostProcessPass {
  readonly name: string;
  readonly inputTexture: GPUTextureView;
  readonly outputTexture: GPUTextureView;
  render(encoder: GPUCommandEncoder): void;
}

/** Options for {@link PostProcessChain}. */
export interface PostProcessOptions {
  /** Swapchain (output) texture format. */
  readonly format: GPUTextureFormat;
  /** Luminance threshold above which a pixel contributes to bloom. Default 0.85. */
  readonly bloomThreshold?: number;
  /** Bloom additive strength. Default 0.8. */
  readonly bloomStrength?: number;
  /** Exposure applied before ACES tone mapping. Default 1.0. */
  readonly exposure?: number;
  /** Bloom working resolution = floor(width/`bloomDownscale`). Default 2. */
  readonly bloomDownscale?: number;
}

const FULLSCREEN_VS = /* wgsl */ `
@vertex
fn vs_full(@builtin(vertex_index) vi : u32) -> VsOut {
  // Fullscreen triangle: (-1,-1), (3,-1), (-1,3).
  var pos = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 3.0, -1.0),
    vec2<f32>(-1.0,  3.0),
  );
  var out : VsOut;
  let p = pos[vi];
  out.clipPos = vec4<f32>(p, 0.0, 1.0);
  // WebGPU textures have (0,0) at top-left; flip v so the scene maps upright.
  out.uv = vec2<f32>(p.x * 0.5 + 0.5, 1.0 - (p.y * 0.5 + 0.5));
  return out;
}
`;

const BRIGHT_FS = /* wgsl */ `
@group(0) @binding(0) var sceneTex : texture_2d<f32>;
@group(0) @binding(1) var samp : sampler;

@fragment
fn fs_main(in : VsOut) -> @location(0) vec4<f32> {
  let col = textureSample(sceneTex, samp, in.uv);
  let l = dot(col.rgb, vec3<f32>(0.2126, 0.7152, 0.0722));
  let above = step(BLOOM_THRESHOLD, l);
  let bright = max(col.rgb - vec3<f32>(BLOOM_THRESHOLD), vec3<f32>(0.0));
  return vec4<f32>(bright * above, 1.0);
}
`;

const BLUR_FS = /* wgsl */ `
@group(0) @binding(0) var srcTex : texture_2d<f32>;
@group(0) @binding(1) var samp : sampler;
@group(0) @binding(2) var<uniform> dir : vec2<f32>;

@fragment
fn fs_main(in : VsOut) -> @location(0) vec4<f32> {
  // 9-tap Gaussian (weights sum to ~1.0).
  let w0 = 0.227027;
  let w1 = 0.1945946;
  let w2 = 0.1216216;
  let w3 = 0.054054;
  let w4 = 0.016216;
  let d = dir * vec2<f32>(1.0, 1.0);
  let base = textureSample(srcTex, samp, in.uv).rgb * w0;
  var sum = base;
  sum += textureSample(srcTex, samp, in.uv + d * 1.0).rgb * w1;
  sum += textureSample(srcTex, samp, in.uv - d * 1.0).rgb * w1;
  sum += textureSample(srcTex, samp, in.uv + d * 2.0).rgb * w2;
  sum += textureSample(srcTex, samp, in.uv - d * 2.0).rgb * w2;
  sum += textureSample(srcTex, samp, in.uv + d * 3.0).rgb * w3;
  sum += textureSample(srcTex, samp, in.uv - d * 3.0).rgb * w3;
  sum += textureSample(srcTex, samp, in.uv + d * 4.0).rgb * w4;
  sum += textureSample(srcTex, samp, in.uv - d * 4.0).rgb * w4;
  return vec4<f32>(sum, 1.0);
}
`;

const TONEMAP_FS = /* wgsl */ `
@group(0) @binding(0) var sceneTex : texture_2d<f32>;
@group(0) @binding(1) var bloomTex : texture_2d<f32>;
@group(0) @binding(2) var samp : sampler;

fn acesTonemap(x : vec3<f32>) -> vec3<f32> {
  let a = 2.51; let b = 0.03; let c = 2.43; let d = 0.59; let e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3<f32>(0.0), vec3<f32>(1.0));
}

@fragment
fn fs_main(in : VsOut) -> @location(0) vec4<f32> {
  let scene = textureSample(sceneTex, samp, in.uv).rgb;
  let bloom = textureSample(bloomTex, samp, in.uv).rgb;
  let hdr = scene + bloom * BLOOM_STRENGTH;
  let ldr = acesTonemap(hdr * EXPOSURE);
  return vec4<f32>(ldr, 1.0);
}
`;

/** Shared vertex-output struct WGSL, prepended to every fragment shader. */
const VS_OUT_STRUCT = /* wgsl */ `
struct VsOut {
  @builtin(position) clipPos : vec4<f32>,
  @location(0) uv : vec2<f32>,
};
`;

/**
 * Owns the HDR scene target and the bloom/tonemap pipelines.
 *
 * Construct after acquiring the GPU device; call {@link PostProcessChain.resize}
 * on canvas resize; render the scene into {@link PostProcessChain.sceneColorView};
 * then call {@link PostProcessChain.render} once per frame.
 */
export class PostProcessChain {
  private readonly device: GPUDevice;
  private readonly format: GPUTextureFormat;
  private readonly bloomThreshold: number;
  private readonly bloomStrength: number;
  private readonly exposure: number;
  private readonly bloomDownscale: number;

  private width = 0;
  private height = 0;
  private bloomW = 0;
  private bloomH = 0;

  private sceneTexture: GPUTexture | null = null;
  private brightTexture: GPUTexture | null = null;
  private blurHTexture: GPUTexture | null = null;
  private bloomTexture: GPUTexture | null = null;

  private readonly sampler: GPUSampler;
  private readonly dirBuffer: GPUBuffer;
  private readonly tonemapPipeline: GPURenderPipeline;
  private readonly brightPipeline: GPURenderPipeline;
  private readonly blurPipeline: GPURenderPipeline;

  public constructor(device: GPUDevice, options: PostProcessOptions) {
    this.device = device;
    this.format = options.format;
    this.bloomThreshold = options.bloomThreshold ?? 0.85;
    this.bloomStrength = options.bloomStrength ?? 0.8;
    this.exposure = options.exposure ?? 1.0;
    this.bloomDownscale = options.bloomDownscale ?? 2;

    this.sampler = device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });

    this.dirBuffer = device.createBuffer({
      size: 16, // vec2 padded to 16
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const defines =
      `const BLOOM_THRESHOLD = ${this.bloomThreshold};\n` +
      `const BLOOM_STRENGTH = ${this.bloomStrength};\n` +
      `const EXPOSURE = ${this.exposure};\n`;

    const vsModule = device.createShaderModule({ code: VS_OUT_STRUCT + '\n' + FULLSCREEN_VS });
    const brightModule = device.createShaderModule({
      code: VS_OUT_STRUCT + '\n' + defines + BRIGHT_FS,
    });
    const blurModule = device.createShaderModule({
      code: VS_OUT_STRUCT + '\n' + defines + BLUR_FS,
    });
    const tonemapModule = device.createShaderModule({
      code: VS_OUT_STRUCT + '\n' + defines + TONEMAP_FS,
    });

    const hdrTarget: GPUColorTargetState = { format: 'rgba16float' };
    this.brightPipeline = device.createRenderPipeline({
      label: 'tdjs-post-bright',
      layout: 'auto',
      vertex: { module: vsModule, entryPoint: 'vs_full' },
      fragment: { module: brightModule, entryPoint: 'fs_main', targets: [hdrTarget] },
      primitive: { topology: 'triangle-list' },
    });
    this.blurPipeline = device.createRenderPipeline({
      label: 'tdjs-post-blur',
      layout: 'auto',
      vertex: { module: vsModule, entryPoint: 'vs_full' },
      fragment: { module: blurModule, entryPoint: 'fs_main', targets: [hdrTarget] },
      primitive: { topology: 'triangle-list' },
    });
    this.tonemapPipeline = device.createRenderPipeline({
      label: 'tdjs-post-tonemap',
      layout: 'auto',
      vertex: { module: vsModule, entryPoint: 'vs_full' },
      fragment: {
        module: tonemapModule,
        entryPoint: 'fs_main',
        targets: [{ format: this.format }],
      },
      primitive: { topology: 'triangle-list' },
    });
  }

  /** View of the HDR scene color target the scene should render into. */
  public get sceneColorView(): GPUTextureView {
    if (this.sceneTexture === null) {
      throw new Error('PostProcessChain.resize must be called before use.');
    }
    return this.sceneTexture.createView();
  }

  /** HDR scene target format. */
  public static readonly SCENE_FORMAT: GPUTextureFormat = 'rgba16float';

  /** (Re)create the scene + bloom textures for `w`×`h`. No-op if unchanged. */
  public resize(w: number, h: number): void {
    const width = Math.max(1, Math.floor(w));
    const height = Math.max(1, Math.floor(h));
    const bw = Math.max(1, Math.floor(width / this.bloomDownscale));
    const bh = Math.max(1, Math.floor(height / this.bloomDownscale));
    if (
      width === this.width &&
      height === this.height &&
      this.sceneTexture !== null
    ) {
      return;
    }
    this.width = width;
    this.height = height;
    this.bloomW = bw;
    this.bloomH = bh;

    this.sceneTexture?.destroy();
    this.brightTexture?.destroy();
    this.blurHTexture?.destroy();
    this.bloomTexture?.destroy();

    this.sceneTexture = this.device.createTexture({
      size: { width, height, depthOrArrayLayers: 1 },
      format: PostProcessChain.SCENE_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      label: 'tdjs-post-scene',
    });
    this.brightTexture = this.device.createTexture({
      size: { width: bw, height: bh, depthOrArrayLayers: 1 },
      format: 'rgba16float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      label: 'tdjs-post-bright',
    });
    this.blurHTexture = this.device.createTexture({
      size: { width: bw, height: bh, depthOrArrayLayers: 1 },
      format: 'rgba16float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      label: 'tdjs-post-blurh',
    });
    this.bloomTexture = this.device.createTexture({
      size: { width: bw, height: bh, depthOrArrayLayers: 1 },
      format: 'rgba16float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      label: 'tdjs-post-bloom',
    });
  }

  /**
   * Run the bloom + tonemap passes into `swapchainView`. Records and submits
   * one command buffer.
   */
  public render(swapchainView: GPUTextureView): void {
    if (
      this.sceneTexture === null ||
      this.brightTexture === null ||
      this.blurHTexture === null ||
      this.bloomTexture === null
    ) {
      throw new Error('PostProcessChain.resize must be called before render.');
    }
    const device = this.device;
    const sceneView = this.sceneTexture.createView();
    const brightView = this.brightTexture.createView();
    const blurHView = this.blurHTexture.createView();
    const bloomView = this.bloomTexture.createView();

    const encoder = device.createCommandEncoder({ label: 'tdjs-post' });

    // a. bright pass: scene (full) -> bright (half)
    const brightBg = device.createBindGroup({
      layout: this.brightPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: sceneView },
        { binding: 1, resource: this.sampler },
      ],
    });
    this.runPass(encoder, this.brightPipeline, brightView, this.bloomW, this.bloomH, [
      { groupIndex: 0, bindGroup: brightBg },
    ]);

    // b. blur H: bright -> blurH
    this.writeDir(1.0 / this.bloomW, 0.0);
    const blurHBg = device.createBindGroup({
      layout: this.blurPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: brightView },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: { buffer: this.dirBuffer } },
      ],
    });
    this.runPass(encoder, this.blurPipeline, blurHView, this.bloomW, this.bloomH, [
      { groupIndex: 0, bindGroup: blurHBg },
    ]);

    // c. blur V: blurH -> bloom
    this.writeDir(0.0, 1.0 / this.bloomH);
    const blurVBg = device.createBindGroup({
      layout: this.blurPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: blurHView },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: { buffer: this.dirBuffer } },
      ],
    });
    this.runPass(encoder, this.blurPipeline, bloomView, this.bloomW, this.bloomH, [
      { groupIndex: 0, bindGroup: blurVBg },
    ]);

    // d. tonemap: scene (full) + bloom (half) -> swapchain
    const tonemapBg = device.createBindGroup({
      layout: this.tonemapPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: sceneView },
        { binding: 1, resource: bloomView },
        { binding: 2, resource: this.sampler },
      ],
    });
    this.runPass(encoder, this.tonemapPipeline, swapchainView, this.width, this.height, [
      { groupIndex: 0, bindGroup: tonemapBg },
    ]);

    device.queue.submit([encoder.finish()]);
  }

  public dispose(): void {
    this.sceneTexture?.destroy();
    this.brightTexture?.destroy();
    this.blurHTexture?.destroy();
    this.bloomTexture?.destroy();
    this.dirBuffer.destroy();
    this.sceneTexture = null;
    this.brightTexture = null;
    this.blurHTexture = null;
    this.bloomTexture = null;
  }

  // ---- internals ---------------------------------------------------------

  private writeDir(x: number, y: number): void {
    this.device.queue.writeBuffer(
      this.dirBuffer,
      0,
      new Float32Array([x, y, 0, 0]),
    );
  }

  private runPass(
    encoder: GPUCommandEncoder,
    pipeline: GPURenderPipeline,
    colorView: GPUTextureView,
    w: number,
    h: number,
    groups: readonly { groupIndex: number; bindGroup: GPUBindGroup }[],
  ): void {
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: colorView,
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });
    pass.setPipeline(pipeline);
    for (const g of groups) pass.setBindGroup(g.groupIndex, g.bindGroup);
    pass.draw(3, 1, 0, 0);
    pass.end();
  }
}
