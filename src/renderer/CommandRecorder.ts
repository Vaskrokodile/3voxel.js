/**
 * Per-frame command recording.
 *
 * A {@link CommandRecorder} builds one render pass per frame: it begins the
 * pass with color + depth attachments, executes a list of {@link DrawSubmission}
 * (set pipeline, bind groups, vertex/index buffers, drawIndexed), ends the
 * pass, and submits the command buffer to the queue.
 */

import type { DrawSubmission } from './types.js';

/** Attachment configuration for a frame. */
export interface FrameAttachments {
  /**
   * View of the color target. With MSAA this is the MSAA render target view;
   * without MSAA it is the swapchain texture view directly.
   */
  readonly colorView: GPUTextureView;
  /**
   * Resolve target for MSAA (the swapchain view). Leave `undefined` when
   * `sampleCount === 1`.
   */
  readonly resolveTarget?: GPUTextureView;
  /** View of the depth/stencil target. */
  readonly depthView: GPUTextureView;
  /** MSAA sample count (1 = no MSAA). */
  readonly sampleCount: number;
  /** Depth/stencil format. */
  readonly depthFormat: GPUTextureFormat;
  /** Clear color (rgba). */
  readonly clearColor: GPUColor;
  /** Whether to clear the color + depth targets this frame. */
  readonly clear: boolean;
}

/**
 * Records one render pass and submits it.
 *
 * Lifecycle per frame:
 *   1. {@link CommandRecorder.beginFrame} — starts an encoder + render pass.
 *   2. {@link CommandRecorder.draw}       — records draw submissions.
 *   3. {@link CommandRecorder.endFrame}   — ends pass + submits.
 */
export class CommandRecorder {
  private readonly device: GPUDevice;
  private readonly queue: GPUQueue;
  private encoder: GPUCommandEncoder | null = null;
  private pass: GPURenderPassEncoder | null = null;
  private pipelineLookup: ((key: string) => GPURenderPipeline) | null = null;

  public constructor(device: GPUDevice) {
    this.device = device;
    this.queue = device.queue;
  }

  /** Begin a new frame: create an encoder and a render pass. */
  public beginFrame(attachments: FrameAttachments): void {
    if (this.encoder !== null || this.pass !== null) {
      throw new Error('CommandRecorder.beginFrame called without ending the previous frame.');
    }
    const encoder = this.device.createCommandEncoder();

    const colorAttachment: GPURenderPassColorAttachment = {
      view: attachments.colorView,
      clearValue: attachments.clearColor,
      loadOp: attachments.clear ? 'clear' : 'load',
      storeOp: 'store',
    };
    if (attachments.sampleCount > 1 && attachments.resolveTarget !== undefined) {
      colorAttachment.resolveTarget = attachments.resolveTarget;
    }

    const depthStencil: GPURenderPassDepthStencilAttachment = {
      view: attachments.depthView,
      depthClearValue: 1.0,
      depthLoadOp: attachments.clear ? 'clear' : 'load',
      depthStoreOp: 'store',
    };

    const pass = encoder.beginRenderPass({
      colorAttachments: [colorAttachment],
      depthStencilAttachment: depthStencil,
    });
    this.encoder = encoder;
    this.pass = pass;
  }

  /** Record a list of draw submissions into the current pass. */
  public draw(submissions: readonly DrawSubmission[]): void {
    const pass = this.pass;
    if (pass === null) {
      throw new Error('CommandRecorder.draw called outside of a frame.');
    }
    const lookup = this.pipelineLookup;
    if (lookup === null) {
      throw new Error('No pipeline lookup configured on CommandRecorder.');
    }
    for (const s of submissions) {
      const pipeline = lookup(s.pipelineKey);
      pass.setPipeline(pipeline);
      for (const u of s.uniforms) {
        if (u.dynamicOffsets !== undefined && u.dynamicOffsets.length > 0) {
          pass.setBindGroup(u.groupIndex, u.bindGroup, u.dynamicOffsets);
        } else {
          pass.setBindGroup(u.groupIndex, u.bindGroup);
        }
      }
      pass.setIndexBuffer(s.indexBuffer, s.indexFormat);
      pass.setVertexBuffer(0, s.vertexBuffer);
      pass.drawIndexed(s.indexCount, 1, s.firstIndex ?? 0, 0, 0);
    }
  }

  /** End the pass and submit the command buffer. */
  public endFrame(): void {
    const pass = this.pass;
    const encoder = this.encoder;
    if (pass === null || encoder === null) {
      throw new Error('CommandRecorder.endFrame called without beginFrame.');
    }
    pass.end();
    const cmd = encoder.finish();
    this.queue.submit([cmd]);
    this.pass = null;
    this.encoder = null;
  }

  /** Set the function used to resolve pipeline keys (used by Renderer). */
  public setPipelineLookup(fn: (key: string) => GPURenderPipeline): void {
    this.pipelineLookup = fn;
  }
}
