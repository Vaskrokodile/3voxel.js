/**
 * Top-level renderer facade.
 *
 * Ties together {@link Device}, {@link ShaderCache}, {@link PipelineCache},
 * {@link BufferManager}, and {@link TextureManager}. Owns the depth texture and
 * (when MSAA is enabled) the MSAA color resolve texture, recreating them on
 * resize. Exposes a single {@link Renderer.render} entry point that writes the
 * per-frame camera uniform and records/submits a frame via
 * {@link CommandRecorder}.
 */

import type { Logger } from '../core/types.js';
import { createDevice, type Device } from './Device.js';
import { ShaderCache } from './ShaderCache.js';
import { PipelineCache, PipelineKeyBuilder, toVertexBufferLayout, type PipelineKeyParts } from './PipelineCache.js';
import { BufferManager } from './BufferManager.js';
import { TextureManager } from './TextureManager.js';
import { CommandRecorder, type FrameAttachments } from './CommandRecorder.js';
import { CameraUniform, type CameraUniformData } from './UniformBuffer.js';
import type { DrawSubmission, RendererOptions, VertexLayout } from './types.js';
import { RendererError } from './types.js';
import { hashString } from './hash.js';

const DEFAULT_SAMPLE_COUNT = 4;
const DEFAULT_DEPTH_FORMAT: GPUTextureFormat = 'depth24plus';
const CLEAR_COLOR: GPUColor = { r: 0.05, g: 0.07, b: 0.12, a: 1.0 };

/** The complete renderer. Construct via {@link Renderer.create}. */
export class Renderer {
  private readonly device: Device;
  private readonly logger: Logger;
  private readonly sampleCount: number;
  private readonly depthFormat: GPUTextureFormat;
  private readonly shaders: ShaderCache;
  private readonly pipelines: PipelineCache;
  private readonly buffers: BufferManager;
  private readonly textures: TextureManager;
  private readonly recorder: CommandRecorder;
  private readonly cameraUniform: CameraUniform;
  private readonly cameraBuffer: GPUBuffer;
  private depthTexture: GPUTexture | null = null;
  private msaaTexture: GPUTexture | null = null;
  private width = 0;
  private height = 0;

  private constructor(
    device: Device,
    logger: Logger,
    sampleCount: number,
    depthFormat: GPUTextureFormat,
  ) {
    this.device = device;
    this.logger = logger;
    this.sampleCount = sampleCount;
    this.depthFormat = depthFormat;
    this.shaders = new ShaderCache(device.device);
    this.pipelines = new PipelineCache(device.device);
    this.buffers = new BufferManager(device.device, logger);
    this.textures = new TextureManager(device.device, logger);
    this.recorder = new CommandRecorder(device.device);
    this.recorder.setPipelineLookup((key) => {
      const p = this.pipelines.getIfExists(key);
      if (p === undefined) {
        throw new RendererError('Unregistered pipeline key referenced by a submission.', { key });
      }
      return p;
    });
    this.cameraUniform = new CameraUniform();
    this.cameraBuffer = this.buffers.createUniformBuffer(CameraUniform.SIZE);
  }

  /**
   * Create a renderer from {@link RendererOptions}. Acquires the GPU device,
   * configures the canvas, and sizes the depth/MSAA textures.
   */
  public static async create(options: RendererOptions): Promise<Renderer> {
    const logger: Logger = options.logger ?? noopLogger;
    const sampleCount = options.sampleCount ?? DEFAULT_SAMPLE_COUNT;
    const depthFormat = options.depthFormat ?? DEFAULT_DEPTH_FORMAT;
    const device = await createDevice(options.canvas, logger);
    const renderer = new Renderer(device, logger, sampleCount, depthFormat);
    renderer.resize(
      Math.max(1, options.canvas.clientWidth || options.canvas.width),
      Math.max(1, options.canvas.clientHeight || options.canvas.height),
    );
    return renderer;
  }

  /** The GPU device. */
  public get gpu(): GPUDevice {
    return this.device.device;
  }
  /** The device queue. */
  public get queue(): GPUQueue {
    return this.device.queue;
  }
  /** Swapchain format. */
  public get format(): GPUTextureFormat {
    return this.device.format;
  }
  /** Depth/stencil format. */
  public get depthStencilFormat(): GPUTextureFormat {
    return this.depthFormat;
  }
  /** MSAA sample count. */
  public get samples(): number {
    return this.sampleCount;
  }
  /** Shader cache. */
  public get shaderCache(): ShaderCache {
    return this.shaders;
  }
  /** Pipeline cache + key builder. */
  public get pipelineCache(): PipelineCache {
    return this.pipelines;
  }
  public get pipelineKeyBuilder(): PipelineKeyBuilder {
    return this.pipelines.builder;
  }
  /** Buffer manager. */
  public get bufferManager(): BufferManager {
    return this.buffers;
  }
  /** Texture manager. */
  public get textureManager(): TextureManager {
    return this.textures;
  }
  /** The per-frame camera uniform buffer (bind group 0 target). */
  public get cameraUniformBuffer(): GPUBuffer {
    return this.cameraBuffer;
  }

  /**
   * Resize the render targets to `w`×`h` (CSS/device pixels). Recreates the
   * depth and MSAA textures. Safe to call every frame (no-op if unchanged).
   */
  public resize(w: number, h: number): void {
    const width = Math.max(1, Math.floor(w));
    const height = Math.max(1, Math.floor(h));
    if (width === this.width && height === this.height && this.depthTexture !== null) {
      return;
    }
    this.width = width;
    this.height = height;
    this.device.canvas.width = width;
    this.device.canvas.height = height;

    this.depthTexture?.destroy();
    this.msaaTexture?.destroy();

    this.depthTexture = this.device.device.createTexture({
      size: { width, height, depthOrArrayLayers: 1 },
      format: this.depthFormat,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
      sampleCount: this.sampleCount,
      label: 'tdjs-depth',
    });

    if (this.sampleCount > 1) {
      this.msaaTexture = this.device.device.createTexture({
        size: { width, height, depthOrArrayLayers: 1 },
        format: this.device.format,
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
        sampleCount: this.sampleCount,
        label: 'tdjs-msaa',
      });
    } else {
      this.msaaTexture = null;
    }
    this.logger.log('debug', 'Renderer resized.', { width, height, sampleCount: this.sampleCount });
  }

  /** Current render width in pixels. */
  public get widthPx(): number {
    return this.width;
  }
  /** Current render height in pixels. */
  public get heightPx(): number {
    return this.height;
  }

  /**
   * A view of the current swapchain texture. Call once per frame, immediately
   * before rendering into it (the texture is re-acquired each frame). Useful
   * as the final destination of a post-process chain.
   */
  public get currentSwapchainView(): GPUTextureView {
    return this.device.context.getCurrentTexture().createView();
  }

  /**
   * Render one frame: write the camera uniform, begin a render pass, record
   * `submissions`, and submit.
   *
   * @param cameraUniformData Per-frame camera data.
   * @param submissions       Draw calls to record this frame.
   * @param clear             Whether to clear the targets (default true).
   */
  public render(
    cameraUniformData: CameraUniformData,
    submissions: readonly DrawSubmission[],
    clear = true,
  ): void {
    if (this.depthTexture === null) {
      throw new RendererError('render() called before resize().');
    }
    this.cameraUniform.write(this.cameraBuffer, this.queue, cameraUniformData);

    const swapchainView = this.device.context.getCurrentTexture().createView();
    const depthView = this.depthTexture.createView();
    const msaa = this.msaaTexture;
    const attachments: FrameAttachments =
      this.sampleCount > 1 && msaa !== null
        ? {
            colorView: msaa.createView(),
            resolveTarget: swapchainView,
            depthView,
            sampleCount: this.sampleCount,
            depthFormat: this.depthFormat,
            clearColor: CLEAR_COLOR,
            clear,
          }
        : {
            colorView: swapchainView,
            depthView,
            sampleCount: 1,
            depthFormat: this.depthFormat,
            clearColor: CLEAR_COLOR,
            clear,
          };

    this.recorder.beginFrame(attachments);
    this.recorder.draw(submissions);
    this.recorder.endFrame();
  }

  /**
   * Render one frame into a provided color view (e.g. an offscreen HDR target
   * for post-processing) instead of the swapchain.
   *
   * Requires `sampleCount === 1` (no MSAA) — the offscreen target must be a
   * non-multisampled texture view. The renderer's depth texture is reused as
   * the depth attachment, so `colorView` must match the renderer's pixel size
   * (call {@link Renderer.resize} first).
   *
   * @param colorView         Target color view (sampleCount 1).
   * @param cameraUniformData Per-frame camera data.
   * @param submissions       Draw calls to record this frame.
   * @param clear             Whether to clear the targets (default true).
   */
  public renderToColorView(
    colorView: GPUTextureView,
    cameraUniformData: CameraUniformData,
    submissions: readonly DrawSubmission[],
    clear = true,
  ): void {
    if (this.depthTexture === null) {
      throw new RendererError('renderToColorView() called before resize().');
    }
    if (this.sampleCount !== 1) {
      throw new RendererError('renderToColorView() requires sampleCount === 1.');
    }
    this.cameraUniform.write(this.cameraBuffer, this.queue, cameraUniformData);

    const depthView = this.depthTexture.createView();
    const attachments: FrameAttachments = {
      colorView,
      depthView,
      sampleCount: 1,
      depthFormat: this.depthFormat,
      clearColor: CLEAR_COLOR,
      clear,
    };

    this.recorder.beginFrame(attachments);
    this.recorder.draw(submissions);
    this.recorder.endFrame();
  }

  /** Release all GPU resources. The renderer is unusable after this. */
  public dispose(): void {
    this.depthTexture?.destroy();
    this.msaaTexture?.destroy();
    this.textures.dispose();
    this.buffers.dispose();
    this.shaders.clear();
    this.pipelines.clear();
    this.logger.log('info', 'Renderer disposed.');
  }

  /**
   * Build a `GPURenderPipelineDescriptor` from a shader + vertex layout +
   * pipeline key parts, register it with the cache, and return the key.
   *
   * This is the primary way for the mesher/world layer to create pipelines
   * without touching raw WebGPU descriptor plumbing. The vertex layout is
   * owned by the mesher; the renderer just forwards it.
   *
   * @param shaderSource WGSL source (compiled + cached via ShaderCache).
   * @param vertexLayout Mesher-owned vertex layout.
   * @param parts        The remaining pipeline-key parts (formats, blend, …).
   * @param extra        Optional overrides for the descriptor (entry points,
   *   depth state, stencil, etc.).
   * @returns The pipeline key (also accepted by {@link DrawSubmission}).
   */
  public registerPipeline(
    shaderSource: string,
    vertexLayout: VertexLayout,
    parts: Omit<PipelineKeyParts, 'shaderHash' | 'vertexLayout'>,
    extra: Partial<GPURenderPipelineDescriptor> = {},
  ): string {
    const shaderHash = hashString(shaderSource);
    const key = this.pipelineKeyBuilder.build({ ...parts, shaderHash, vertexLayout });
    if (this.pipelines.has(key)) {
      return key;
    }
    const module = this.shaders.getShader(shaderSource);
    const vertexBase: Partial<GPUVertexState> = extra.vertex ?? {};
    const fragmentBase: Partial<GPUFragmentState> = extra.fragment ?? {};
    const primitiveBase: Partial<GPUPrimitiveState> = extra.primitive ?? {};
    const depthBase: Partial<GPUDepthStencilState> = extra.depthStencil ?? {};
    const multisampleBase: Partial<GPUMultisampleState> = extra.multisample ?? {};

    const colorTarget: GPUColorTargetState = { format: parts.colorFormat };
    if (parts.blend !== undefined) {
      colorTarget.blend = parts.blend;
    }

    const depthStencil: GPUDepthStencilState = {
      format: parts.depthFormat ?? this.depthFormat,
      depthCompare: depthBase.depthCompare ?? 'less',
      depthWriteEnabled: depthBase.depthWriteEnabled ?? true,
    };

    const descriptor: GPURenderPipelineDescriptor = {
      label: key,
      layout: extra.layout ?? 'auto',
      vertex: {
        module,
        entryPoint: vertexBase.entryPoint ?? 'vs_main',
        buffers: [toVertexBufferLayout(vertexLayout)],
      },
      fragment: {
        module,
        entryPoint: fragmentBase.entryPoint ?? 'fs_main',
        targets: [colorTarget],
      },
      primitive: {
        topology: parts.topology,
        ...primitiveBase,
      },
      depthStencil,
      multisample: {
        count: parts.sampleCount,
        ...multisampleBase,
      },
    };
    this.pipelines.getPipeline(key, descriptor);
    return key;
  }
}

const noopLogger: Logger = {
  log() {
    /* no-op */
  },
};
