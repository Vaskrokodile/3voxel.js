/**
 * Texture + sampler management.
 *
 * Voxel engines typically use a 2D texture *array* (one layer per block-face
 * texture or per block type) so a single `texture_2d_array` binding serves all
 * blocks without rebinding. This module creates such arrays and uploads their
 * pixels, plus creates samplers.
 */

import type { Logger } from '../core/types.js';
import { RendererError } from './types.js';
import { toGPUBufferSource } from './util.js';

/** Options for creating a 2D texture array. */
export interface TextureArrayOptions {
  /** Pixel width of each layer (must be equal for all layers). */
  readonly width: number;
  /** Pixel height of each layer. */
  readonly height: number;
  /** Number of array layers. */
  readonly layers: number;
  /** Texel format, e.g. `rgba8unorm`. */
  readonly format: GPUTextureFormat;
  /** Mip level count (default 1). */
  readonly mipLevelCount?: number;
  /** Per-layer source bytes, laid out top-to-bottom, tightly packed per row. */
  readonly data: readonly (Uint8Array | undefined)[];
  /** Optional usage flags; defaults to TEXTURE_BINDING | COPY_DST. */
  readonly usage?: GPUTextureUsageFlags;
  /** Optional label. */
  readonly label?: string;
}

/** Options for {@link TextureManager.createSampler}. */
export interface SamplerOptions {
  readonly magFilter?: GPUFilterMode;
  readonly minFilter?: GPUFilterMode;
  readonly mipmapFilter?: GPUMipmapFilterMode;
  readonly addressModeU?: GPUAddressMode;
  readonly addressModeV?: GPUAddressMode;
  readonly addressModeW?: GPUAddressMode;
  readonly maxAnisotropy?: number;
  readonly label?: string;
}

/** Creates GPU textures and samplers. */
export class TextureManager {
  private readonly device: GPUDevice;
  private readonly queue: GPUQueue;
  private readonly logger: Logger | undefined;
  private readonly textures: GPUTexture[] = [];
  private readonly samplers: GPUSampler[] = [];

  public constructor(device: GPUDevice, logger?: Logger) {
    this.device = device;
    this.queue = device.queue;
    this.logger = logger;
  }

  /**
   * Create a 2D texture array and upload per-layer pixel data.
   *
   * @throws {RendererError} if `data.length` !== `layers`.
   */
  public createTextureFromData(opts: TextureArrayOptions): GPUTexture {
    if (opts.data.length !== opts.layers) {
      const err = new RendererError('Texture array data/layer count mismatch.', {
        dataLength: opts.data.length,
        layers: opts.layers,
      });
      this.logger?.log('error', err.message, err.context);
      throw err;
    }
    const mipLevelCount = opts.mipLevelCount ?? 1;
    const usage = opts.usage ?? (GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST);
    const texture = this.device.createTexture({
      size: { width: opts.width, height: opts.height, depthOrArrayLayers: opts.layers },
      format: opts.format,
      usage,
      mipLevelCount,
      dimension: '2d',
      label: opts.label ?? 'voxel-texture-array',
    });
    this.textures.push(texture);

    for (let layer = 0; layer < opts.layers; layer++) {
      const src = opts.data[layer];
      if (src === undefined) {
        continue; // leave layer uninitialized
      }
      this.queue.writeTexture(
        { texture, mipLevel: 0, origin: { x: 0, y: 0, z: layer } },
        toGPUBufferSource(src),
        { bytesPerRow: opts.width * bytesPerPixel(opts.format) },
        { width: opts.width, height: opts.height, depthOrArrayLayers: 1 },
      );
    }
    return texture;
  }

  /** Create a sampler. */
  public createSampler(opts: SamplerOptions): GPUSampler {
    const sampler = this.device.createSampler({
      magFilter: opts.magFilter ?? 'nearest',
      minFilter: opts.minFilter ?? 'nearest',
      mipmapFilter: opts.mipmapFilter ?? 'nearest',
      addressModeU: opts.addressModeU ?? 'clamp-to-edge',
      addressModeV: opts.addressModeV ?? 'clamp-to-edge',
      addressModeW: opts.addressModeW ?? 'clamp-to-edge',
      maxAnisotropy: opts.maxAnisotropy ?? 1,
      label: opts.label ?? 'voxel-sampler',
    });
    this.samplers.push(sampler);
    return sampler;
  }

  /** Create a `GPUTextureView` for a texture array (all layers, all mips). */
  public createArrayView(texture: GPUTexture): GPUTextureView {
    return texture.createView({
      dimension: '2d-array',
      arrayLayerCount: texture.depthOrArrayLayers,
    });
  }

  /** Destroy all tracked textures and samplers. */
  public dispose(): void {
    for (const t of this.textures) t.destroy();
    // GPUSampler has no destroy(); release references.
    this.textures.length = 0;
    this.samplers.length = 0;
  }
}

/** Bytes per texel for the formats we expect to use. */
function bytesPerPixel(format: GPUTextureFormat): number {
  switch (format) {
    case 'rgba8unorm':
    case 'rgba8unorm-srgb':
    case 'bgra8unorm':
    case 'bgra8unorm-srgb':
      return 4;
    case 'rg8unorm':
      return 2;
    case 'r8unorm':
      return 1;
    case 'rgba16float':
      return 8;
    case 'r32float':
      return 4;
    default:
      // Conservative default; caller should pass explicit bytesPerRow if needed.
      return 4;
  }
}
