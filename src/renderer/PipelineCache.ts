/**
 * Render pipeline cache.
 *
 * Caches `GPURenderPipeline` objects by a string key that uniquely encodes all
 * state that affects pipeline compilation: the shader module hash, the vertex
 * layout, color/depth formats, blend state, primitive topology, and MSAA
 * sample count. The key is built by {@link PipelineKeyBuilder} so callers can
 * compute a key without creating the pipeline, then hand it (plus a full
 * descriptor) to {@link PipelineCache.getPipeline}.
 */

import type { VertexLayout } from './types.js';
import { hashString } from './hash.js';

/**
 * The pieces of state that determine a unique render pipeline. These are the
 * only inputs to the cache key.
 */
export interface PipelineKeyParts {
  /** Hash of the WGSL source (see {@link ShaderCache}). */
  readonly shaderHash: string;
  /** Vertex buffer layout (owned by the mesher). */
  readonly vertexLayout: VertexLayout;
  /** Output color attachment format (swapchain format). */
  readonly colorFormat: GPUTextureFormat;
  /** Depth attachment format. */
  readonly depthFormat: GPUTextureFormat | undefined;
  /** Blend state for color attachment 0, if any. */
  readonly blend: GPUBlendState | undefined;
  /** Primitive topology (triangle-list, line-list, …). */
  readonly topology: GPUPrimitiveTopology;
  /** MSAA sample count (1 = no MSAA). */
  readonly sampleCount: number;
}

/** Builds deterministic cache keys from {@link PipelineKeyParts}. */
export class PipelineKeyBuilder {
  /**
   * Produce a stable string key for the given pipeline state.
   * Two equal keys guarantee the same `GPURenderPipeline` may be reused.
   */
  public build(parts: PipelineKeyParts): string {
    const layoutKey = serializeVertexLayout(parts.vertexLayout);
    const blendKey = parts.blend === undefined ? 'none' : serializeBlend(parts.blend);
    const depthKey = parts.depthFormat ?? 'none';
    return [
      'pipe',
      parts.shaderHash,
      layoutKey,
      parts.colorFormat,
      depthKey,
      blendKey,
      parts.topology,
      `s${parts.sampleCount}`,
    ].join('|');
  }
}

function serializeVertexLayout(layout: VertexLayout): string {
  const attrs = layout.attributes
    .slice()
    .sort((a, b) => a.shaderLocation - b.shaderLocation)
    .map((a) => `${a.shaderLocation}:${a.format}@${a.offset}#${a.name}`)
    .join(',');
  return `v[${attrs}]{${layout.stride},${layout.stepMode}}`;
}

function serializeBlend(b: GPUBlendState): string {
  return `c=${serializeBlendComponent(b.color)};a=${serializeBlendComponent(b.alpha)}`;
}

function serializeBlendComponent(c: GPUBlendComponent): string {
  return `${c.operation ?? 'add'}+${c.srcFactor ?? 'one'}*${c.dstFactor ?? 'zero'}`;
}

/** Caches `GPURenderPipeline`s by key (see {@link PipelineKeyBuilder}). */
export class PipelineCache {
  private readonly device: GPUDevice;
  private readonly cache = new Map<string, GPURenderPipeline>();
  private readonly keyBuilder: PipelineKeyBuilder;

  public constructor(device: GPUDevice, keyBuilder?: PipelineKeyBuilder) {
    this.device = device;
    this.keyBuilder = keyBuilder ?? new PipelineKeyBuilder();
  }

  /** Expose the key builder for callers that need to compute keys. */
  public get builder(): PipelineKeyBuilder {
    return this.keyBuilder;
  }

  /**
   * Get (creating + caching if needed) the render pipeline for `key`.
   *
   * @param key Key from {@link PipelineKeyBuilder.build}.
   * @param descriptor Full `GPURenderPipelineDescriptor`. Must be consistent
   *   with the key. The descriptor's `layout` may be `'auto'` or a real layout.
   */
  public getPipeline(key: string, descriptor: GPURenderPipelineDescriptor): GPURenderPipeline {
    const existing = this.cache.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const pipeline = this.device.createRenderPipeline(descriptor);
    this.cache.set(key, pipeline);
    return pipeline;
  }

  /** Whether a pipeline is already cached for `key`. */
  public has(key: string): boolean {
    return this.cache.has(key);
  }

  /** Return the cached pipeline for `key`, or `undefined` if not present. */
  public getIfExists(key: string): GPURenderPipeline | undefined {
    return this.cache.get(key);
  }

  /** Number of cached pipelines. */
  public get size(): number {
    return this.cache.size;
  }

  /** Drop all cached pipelines. */
  public clear(): void {
    this.cache.clear();
  }
}

/**
 * Convenience: build a `GPUVertexBufferLayout` from a mesher-owned
 * {@link VertexLayout}. Used when constructing a pipeline descriptor.
 */
export function toVertexBufferLayout(layout: VertexLayout): GPUVertexBufferLayout {
  return {
    arrayStride: layout.stride,
    stepMode: layout.stepMode,
    attributes: layout.attributes.map((a) => ({
      shaderLocation: a.shaderLocation,
      offset: a.offset,
      format: a.format,
    })),
  };
}

// Re-export the hash helper for callers that want to hash shader source the
// same way the renderer does.
export { hashString };
