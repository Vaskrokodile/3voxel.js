/**
 * Renderer-specific types for tdjs.
 *
 * The renderer is intentionally agnostic of the mesher's vertex layout.
 * The mesher owns the interleaved vertex byte layout and hands the renderer a
 * {@link VertexLayout} descriptor describing how to read it. The renderer never
 * hardcodes attribute offsets, formats, or stride — it consumes whatever
 * layout the mesher declares. This keeps the mesher free to pack attributes
 * (position, normal, AO, UV, blockId, …) in any order/combination.
 */

import type { Logger } from '../core/types.js';

/**
 * A single vertex attribute within an interleaved vertex buffer.
 *
 * `offset` is relative to the start of one vertex (i.e. within the stride).
 * The renderer uses `shaderLocation` to wire this to a WGSL `@location(...)`.
 */
export interface VertexAttribute {
  /** Logical name (for debugging/keying only; not sent to GPU). */
  readonly name: string;
  /** Matches the `@location(n)` in the WGSL entry-point input struct. */
  readonly shaderLocation: number;
  /** WebGPU vertex format, e.g. `float32x3`, `unorm8x4`. */
  readonly format: GPUVertexFormat;
  /** Byte offset of this attribute within one vertex. */
  readonly offset: number;
}

/**
 * Describes the layout of an interleaved vertex buffer.
 *
 * OWNED BY THE MESHER. The renderer accepts this descriptor and builds
 * `GPUVertexBufferLayout` + `GPUVertexState` from it. It does not assume any
 * particular set of attributes.
 */
export interface VertexLayout {
  /** Attributes, in any order. */
  readonly attributes: readonly VertexAttribute[];
  /** Bytes between consecutive vertices. */
  readonly stride: number;
  /** Vertex or instance step mode. */
  readonly stepMode: GPUVertexStepMode;
}

/**
 * A bind group (and optional dynamic offsets) to bind for a draw call.
 *
 * `groupIndex` is the `@group(n)` index in WGSL. A typical voxel pipeline uses
 * group 0 for the per-frame camera uniform and group 1 for per-draw material
 * data; each submission carries whichever bind groups it needs.
 */
export interface UniformBindGroup {
  /** The `@group(n)` index this bind group binds to. */
  readonly groupIndex: number;
  /** Compiled bind group object. */
  readonly bindGroup: GPUBindGroup;
  /** Dynamic offsets for dynamic uniform buffers, if any. */
  readonly dynamicOffsets?: readonly number[];
}

/**
 * One indexed draw call. The renderer records a list of these per frame.
 *
 * `pipelineKey` must match a key previously registered with the PipelineCache.
 */
export interface DrawSubmission {
  /** Key returned by {@link PipelineKeyBuilder.build} / PipelineCache. */
  readonly pipelineKey: string;
  /** Interleaved vertex buffer matching the pipeline's VertexLayout. */
  readonly vertexBuffer: GPUBuffer;
  /** Index buffer; format must match the pipeline's indexFormat. */
  readonly indexBuffer: GPUBuffer;
  /** `uint16` or `uint32`. */
  readonly indexFormat: GPUIndexFormat;
  /** Number of indices to draw. */
  readonly indexCount: number;
  /** First index (for splitting opaque/transparent ranges of one mesh). */
  readonly firstIndex?: number;
  /** Bind groups to set before drawing (camera, material, …). */
  readonly uniforms: readonly UniformBindGroup[];
}

/** Options for constructing a {@link Renderer}. */
export interface RendererOptions {
  /** Canvas to render into. */
  readonly canvas: HTMLCanvasElement;
  /** Optional logger; if omitted, a no-op logger is used. */
  readonly logger?: Logger;
  /** MSAA sample count (default 4). Use 1 to disable MSAA. */
  readonly sampleCount?: number;
  /** Depth/stencil texture format (default `depth24plus`). */
  readonly depthFormat?: GPUTextureFormat;
}

/** Typed error thrown by the renderer, with context for the Logger. */
export class RendererError extends Error {
  public readonly context: Record<string, unknown> | undefined;
  public constructor(message: string, context?: Record<string, unknown>) {
    super(message);
    this.name = 'RendererError';
    this.context = context;
  }
}
