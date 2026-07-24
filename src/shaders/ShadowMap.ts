/**
 * Directional sun shadow map (phase 1: single cascade, PCF).
 *
 * Renders the scene's opaque geometry from the sun's point of view into a
 * depth texture, then exposes that texture + the light-space view-projection
 * so the world fragment shader can sample it with `textureSampleCompareLevel`
 * for hardware-PCF shadows.
 *
 * The shadow camera is an orthographic box centred on a focus point (typically
 * the player), snapped to the shadow-map texel grid to reduce edge shimmer.
 */

import type { Mat4 } from '../core/types.js';
import type { Vec3 } from '../core/types.js';
import { mat4LookAt, mat4Ortho, mat4Multiply } from '../core/math/index.js';
import type { VertexLayout } from '../renderer/types.js';
import { toVertexBufferLayout } from '../renderer/PipelineCache.js';
import type { DrawSubmission } from '../renderer/types.js';

/** Uniform: a single mat4x4 (light-space view-projection). 64 bytes. */
const SHADOW_VP_SIZE = 64;

const SHADOW_VS = /* wgsl */ `
struct ShadowCamera {
  viewProj : mat4x4<f32>,
};
@group(0) @binding(0) var<uniform> shadowCam : ShadowCamera;

struct VertexInput {
  @location(0) position : vec3<f32>,
};
@vertex
fn vs_main(in : VertexInput) -> @builtin(position) vec4<f32> {
  return shadowCam.viewProj * vec4<f32>(in.position, 1.0);
}
`;

/** Options for {@link ShadowMapRenderer}. */
export interface ShadowMapOptions {
  /** Shadow map edge length in texels. Default 2048. */
  readonly size?: number;
  /** Depth format. Default 'depth32float'. */
  readonly depthFormat?: GPUTextureFormat;
  /** Half-extent of the orthographic shadow box (world units). Default 80. */
  readonly extent?: number;
  /** Shadow camera far plane (world units from the focus point). Default 300. */
  readonly far?: number;
  /** Shadow camera near plane. Default 1. */
  readonly near?: number;
}

/**
 * Owns the shadow depth target, the depth-only pipeline, and the light-space
 * matrix uniform.
 *
 * Per frame:
 *   1. Call {@link ShadowMapRenderer.computeMatrix} with the sun direction and
 *      focus point; it writes the uniform and returns the matrix (for the
 *      world shader's shadow bind group, if needed separately).
 *   2. Call {@link ShadowMapRenderer.render} with the opaque draw submissions;
 *      it re-records them with the shadow pipeline into the depth target.
 *   3. Bind {@link ShadowMapRenderer.shadowMapView} in the world shader.
 */
export class ShadowMapRenderer {
  private readonly device: GPUDevice;
  private readonly size: number;
  private readonly depthFormat: GPUTextureFormat;
  private readonly extent: number;
  private readonly far: number;
  private readonly near: number;

  private readonly shadowTexture: GPUTexture;
  private readonly cmpSampler: GPUSampler;
  private readonly vpBuffer: GPUBuffer;
  private readonly bindGroup: GPUBindGroup;
  private readonly pipeline: GPURenderPipeline;

  private readonly view: Mat4;
  private readonly proj: Mat4;
  private readonly viewProj: Mat4;
  private readonly vpData: Float32Array;

  public constructor(device: GPUDevice, vertexLayout: VertexLayout, options: ShadowMapOptions = {}) {
    this.device = device;
    this.size = options.size ?? 2048;
    this.depthFormat = options.depthFormat ?? 'depth32float';
    this.extent = options.extent ?? 80;
    this.far = options.far ?? 300;
    this.near = options.near ?? 1;

    this.shadowTexture = device.createTexture({
      size: { width: this.size, height: this.size, depthOrArrayLayers: 1 },
      format: this.depthFormat,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      label: 'tdjs-shadow-map',
    });

    this.cmpSampler = device.createSampler({
      compare: 'less',
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });

    this.vpBuffer = device.createBuffer({
      size: SHADOW_VP_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      label: 'tdjs-shadow-vp',
    });

    const module = device.createShaderModule({ code: SHADOW_VS });
    this.pipeline = device.createRenderPipeline({
      label: 'tdjs-shadow-pipeline',
      layout: 'auto',
      vertex: {
        module,
        entryPoint: 'vs_main',
        buffers: [toVertexBufferLayout(vertexLayout)],
      },
      primitive: { topology: 'triangle-list', cullMode: 'back' },
      depthStencil: {
        format: this.depthFormat,
        depthCompare: 'less',
        depthWriteEnabled: true,
      },
    });

    this.bindGroup = device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.vpBuffer } }],
    });

    this.view = mat4LookAt(
      { m: new Float32Array(16) } as unknown as Mat4,
      { x: 0, y: 0, z: 0 },
      { x: 0, y: -1, z: 0 },
      { x: 0, y: 1, z: 0 },
    );
    this.proj = { m: new Float32Array(16) } as unknown as Mat4;
    this.viewProj = { m: new Float32Array(16) } as unknown as Mat4;
    this.vpData = new Float32Array(16);
  }

  /** View of the shadow depth texture (bind in the world shader). */
  public get shadowMapView(): GPUTextureView {
    return this.shadowTexture.createView();
  }

  /** Comparison sampler for the shadow map (bind in the world shader). */
  public get shadowSampler(): GPUSampler {
    return this.cmpSampler;
  }

  /** The light-space view-projection uniform buffer (bind in the world shader). */
  public get shadowVPBuffer(): GPUBuffer {
    return this.vpBuffer;
  }

  /**
   * Compute the light-space view-projection for this frame, write it to the
   * uniform buffer, and return the matrix. The focus point is snapped to the
   * shadow texel grid to reduce shimmer.
   */
  public computeMatrix(sunDir: Vec3, focus: Vec3): Mat4 {
    const dir = normalize(sunDir);
    // Eye placed behind the focus along the sun direction.
    const eyeDist = this.far * 0.5;
    const eye: Vec3 = {
      x: focus.x - dir.x * eyeDist,
      y: focus.y - dir.y * eyeDist,
      z: focus.z - dir.z * eyeDist,
    };
    // Up vector: avoid degeneracy when the sun is near-vertical.
    const up: Vec3 = Math.abs(dir.y) > 0.99 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };

    mat4LookAt(this.view, eye, focus, up);
    mat4Ortho(this.proj, -this.extent, this.extent, -this.extent, this.extent, this.near, this.far);
    mat4Multiply(this.viewProj, this.proj, this.view);

    // Snap the focus to the shadow texel grid to reduce edge shimmer: shift
    // the eye + target by the same texel-aligned delta so the view-projection
    // stays stable as the focus moves sub-texel amounts.
    const texel = (2 * this.extent) / this.size;
    const snapX = Math.round(focus.x / texel) * texel - focus.x;
    const snapZ = Math.round(focus.z / texel) * texel - focus.z;
    if (snapX !== 0 || snapZ !== 0) {
      mat4LookAt(this.view, { x: eye.x + snapX, y: eye.y, z: eye.z + snapZ }, { x: focus.x + snapX, y: focus.y, z: focus.z + snapZ }, up);
      mat4Multiply(this.viewProj, this.proj, this.view);
    }

    this.vpData.set(this.viewProj.m);
    this.device.queue.writeBuffer(
      this.vpBuffer,
      0,
      this.vpData as unknown as GPUAllowSharedBufferSource,
    );
    return this.viewProj;
  }

  /**
   * Render the opaque `submissions` into the shadow map using the shadow
   * pipeline. Each submission's vertex/index buffers are reused; the uniforms
   * are replaced with the shadow bind group.
   */
  public render(submissions: readonly DrawSubmission[]): void {
    const encoder = this.device.createCommandEncoder({ label: 'tdjs-shadow' });
    const pass = encoder.beginRenderPass({
      colorAttachments: [],
      depthStencilAttachment: {
        view: this.shadowTexture.createView(),
        depthClearValue: 1.0,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    for (const s of submissions) {
      pass.setIndexBuffer(s.indexBuffer, s.indexFormat);
      pass.setVertexBuffer(0, s.vertexBuffer);
      pass.drawIndexed(s.indexCount, 1, s.firstIndex ?? 0, 0, 0);
    }
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  public dispose(): void {
    this.shadowTexture.destroy();
    this.vpBuffer.destroy();
  }
}

function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}
