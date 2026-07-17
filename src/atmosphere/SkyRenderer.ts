/**
 * Sky dome renderer — full-screen gradient sky with a sun/moon disc.
 *
 * Renders the sky as a single full-screen triangle (3 vertices in NDC covering
 * the whole screen). The fragment shader computes a horizon-to-zenith gradient
 * and draws a sun disc (or moon at night) based on the current time of day.
 *
 * The sky pass should be drawn FIRST, before any world geometry, with depth
 * write disabled and depth test set to `always` so the sky fills the background
 * without occluding the depth buffer.
 */

import type { Vec3 } from '../core/types.js';
import { vec3Normalize } from '../core/math/Vec3.js';
import type { DrawSubmission, VertexLayout } from '../renderer/types.js';
import {
  AtmosphereUniformWriter,
  ATMOSPHERE_UNIFORM_SIZE,
  type AtmosphereUniformData,
} from './AtmosphereUniforms.js';

/** Options for constructing a {@link SkyRenderer}. */
export interface SkyOptions {
  /** GPU device used to create buffers, pipelines, and bind groups. */
  readonly device: GPUDevice;
  /** Swapchain color attachment format. */
  readonly format: GPUTextureFormat;
  /** MSAA sample count (must match the render pass). */
  readonly sampleCount: number;
  /** Depth/stencil attachment format. */
  readonly depthFormat: GPUTextureFormat;
}

// ---- Vertex layout: a single float32x2 position attribute ----------------
//
// Three vertices form a full-screen triangle in NDC:
//   (-1, -1), (3, -1), (-1, 3)
// The third vertex extends past the screen so the single triangle covers it.
const SKY_VERTICES = new Float32Array([
  -1, -1,
  3, -1,
  -1, 3,
]);
const SKY_INDICES = new Uint16Array([0, 1, 2]);

/** Vertex layout for the sky full-screen triangle (one float32x2 attribute). */
export const SKY_VERTEX_LAYOUT: VertexLayout = {
  attributes: [
    { name: 'position', shaderLocation: 0, format: 'float32x2', offset: 0 },
  ],
  stride: 8,
  stepMode: 'vertex',
};

/** Default pipeline key used when not registered with a {@link Renderer}. */
const DEFAULT_PIPELINE_KEY = 'atmosphere:sky';

// ---- Color constants ------------------------------------------------------
const NOON_SUN: Vec3 = { x: 1.0, y: 0.95, z: 0.9 };
const HORIZON_SUN: Vec3 = { x: 1.0, y: 0.6, z: 0.3 };
const NIGHT_SUN: Vec3 = { x: 0.1, y: 0.1, z: 0.2 };

const DAY_AMBIENT: Vec3 = { x: 0.3, y: 0.32, z: 0.4 };
const NIGHT_AMBIENT: Vec3 = { x: 0.04, y: 0.05, z: 0.08 };

const DAY_FOG: Vec3 = { x: 0.6, y: 0.7, z: 0.9 };
const SUNSET_FOG: Vec3 = { x: 1.0, y: 0.6, z: 0.3 };
const NIGHT_FOG: Vec3 = { x: 0.02, y: 0.03, z: 0.06 };

/**
 * Renders a full-screen sky dome with a day/night gradient and sun/moon disc.
 *
 * Call {@link SkyRenderer.update} each frame with the current time of day,
 * then include {@link SkyRenderer.getSubmission} as the first entry in the
 * frame's draw list.
 */
export class SkyRenderer {
  private readonly device: GPUDevice;
  private readonly format: GPUTextureFormat;
  private readonly sampleCount: number;
  private readonly depthFormat: GPUTextureFormat;

  private readonly vertexBuffer: GPUBuffer;
  private readonly indexBuffer: GPUBuffer;
  private readonly atmosphereBuffer: GPUBuffer;
  private readonly writer: AtmosphereUniformWriter;

  private pipeline: GPURenderPipeline;
  private pipelineKey: string;
  private atmosphereBindGroup: GPUBindGroup;
  private cameraBindGroup: GPUBindGroup | null = null;
  private cameraBufferRef: GPUBuffer | null = null;

  private sunDir: Vec3 = { x: 0, y: 1, z: 0.3 };
  private sunCol: Vec3 = { x: 1, y: 0.95, z: 0.9 };
  private ambientCol: Vec3 = { x: 0.3, y: 0.32, z: 0.4 };
  private fogCol: Vec3 = { x: 0.6, y: 0.7, z: 0.9 };
  private currentTime: number = 12;

  public constructor(opts: SkyOptions) {
    this.device = opts.device;
    this.format = opts.format;
    this.sampleCount = opts.sampleCount;
    this.depthFormat = opts.depthFormat;
    this.writer = new AtmosphereUniformWriter();

    // Vertex buffer: 3 vertices × float32x2.
    this.vertexBuffer = this.device.createBuffer({
      size: SKY_VERTICES.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      label: 'atmosphere:sky-vertices',
    });
    this.device.queue.writeBuffer(this.vertexBuffer, 0, SKY_VERTICES);

    // Index buffer: 3 uint16 indices = 6 bytes. WebGPU requires buffer sizes
    // and writeBuffer byte lengths to be multiples of 4, so pad to 8 bytes.
    this.indexBuffer = this.device.createBuffer({
      size: 8,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
      label: 'atmosphere:sky-indices',
    });
    const paddedIndices = new Uint16Array(4);
    paddedIndices[0] = SKY_INDICES[0]!;
    paddedIndices[1] = SKY_INDICES[1]!;
    paddedIndices[2] = SKY_INDICES[2]!;
    this.device.queue.writeBuffer(this.indexBuffer, 0, paddedIndices);

    // Atmosphere uniform buffer (sun dir, colors, fog, time).
    this.atmosphereBuffer = this.device.createBuffer({
      size: ATMOSPHERE_UNIFORM_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      label: 'atmosphere:sky-uniform',
    });

    // Build the render pipeline (layout: 'auto' so bind group layouts are derived).
    this.pipeline = this.buildPipeline();
    this.pipelineKey = DEFAULT_PIPELINE_KEY;

    // Atmosphere bind group (group 1) — created from the pipeline's BGL.
    const bgl1 = this.pipeline.getBindGroupLayout(1);
    this.atmosphereBindGroup = this.device.createBindGroup({
      layout: bgl1,
      entries: [{ binding: 0, resource: { buffer: this.atmosphereBuffer } }],
      label: 'atmosphere:sky-bindgroup1',
    });

    // Initialize with noon.
    this.update(12);
  }

  /**
   * Update the sun direction and atmosphere colors from the time of day.
   *
   * @param timeOfDay Time in [0, 24) hours. 6 = sunrise, 12 = noon, 18 = sunset.
   */
  public update(timeOfDay: number): void {
    this.currentTime = timeOfDay;
    const angle = (timeOfDay - 6) * Math.PI / 12;
    const raw: Vec3 = { x: Math.cos(angle), y: Math.sin(angle), z: 0.3 };
    this.sunDir = vec3Normalize(raw);

    const sunHeight = this.sunDir.y;
    const dayBlend = clamp01(sunHeight);
    const nightBlend = clamp01(-sunHeight);

    // Sun color: horizon → noon during day, horizon → night at night.
    const dayColor = lerp3(HORIZON_SUN, NOON_SUN, dayBlend);
    this.sunCol = lerp3(dayColor, NIGHT_SUN, nightBlend);

    // Ambient: brighter during day, dim at night.
    this.ambientCol = lerp3(NIGHT_AMBIENT, DAY_AMBIENT, dayBlend);

    // Fog color: warm at sunset/sunrise, blue during day, dark at night.
    const sunsetFactor = clamp01(1 - Math.abs(sunHeight) * 3);
    const dayFog = lerp3(DAY_FOG, SUNSET_FOG, sunsetFactor);
    this.fogCol = lerp3(dayFog, NIGHT_FOG, nightBlend);

    // Upload atmosphere data.
    const data: AtmosphereUniformData = {
      sunDirection: this.sunDir,
      sunColor: this.sunCol,
      ambientColor: this.ambientCol,
      fogColor: this.fogCol,
      fogNear: 0,
      fogFar: 0,
      time: timeOfDay,
      _pad: 0,
    };
    this.writer.write(this.atmosphereBuffer, this.device.queue, data);
  }

  /** Current sun direction (normalized, points toward the sun). */
  public get sunDirection(): Vec3 {
    return { x: this.sunDir.x, y: this.sunDir.y, z: this.sunDir.z };
  }

  /** Current sun color (warm at sunrise/sunset, white at noon, dim at night). */
  public get sunColor(): Vec3 {
    return { x: this.sunCol.x, y: this.sunCol.y, z: this.sunCol.z };
  }

  /** Current ambient light color/intensity. */
  public get ambientColor(): Vec3 {
    return { x: this.ambientCol.x, y: this.ambientCol.y, z: this.ambientCol.z };
  }

  /** Fog color (matches horizon sky color). */
  public get fogColor(): Vec3 {
    return { x: this.fogCol.x, y: this.fogCol.y, z: this.fogCol.z };
  }

  /**
   * Build a {@link DrawSubmission} for the sky.
   *
   * This should be drawn FIRST, before any world geometry, with depth write
   * disabled and depth test `always` (configured in the pipeline).
   *
   * @param cameraUniformBuffer The per-frame camera uniform buffer (bind group 0).
   */
  public getSubmission(cameraUniformBuffer: GPUBuffer): DrawSubmission {
    if (this.cameraBindGroup === null || this.cameraBufferRef !== cameraUniformBuffer) {
      const bgl0 = this.pipeline.getBindGroupLayout(0);
      this.cameraBindGroup = this.device.createBindGroup({
        layout: bgl0,
        entries: [{ binding: 0, resource: { buffer: cameraUniformBuffer } }],
        label: 'atmosphere:sky-bindgroup0',
      });
      this.cameraBufferRef = cameraUniformBuffer;
    }
    return {
      pipelineKey: this.pipelineKey,
      vertexBuffer: this.vertexBuffer,
      indexBuffer: this.indexBuffer,
      indexFormat: 'uint16',
      indexCount: 3,
      uniforms: [
        { groupIndex: 0, bindGroup: this.cameraBindGroup },
        { groupIndex: 1, bindGroup: this.atmosphereBindGroup },
      ],
    };
  }

  /**
   * The pipeline key used in draw submissions.
   *
   * When {@link SkyRenderer.registerWithRenderer} is called, this is the key
   * returned by the renderer's pipeline cache.
   */
  public get currentPipelineKey(): string {
    return this.pipelineKey;
  }

  /**
   * Set the pipeline key to use for draw submissions.
   *
   * Call this after registering the sky shader with a renderer's pipeline cache
   * (e.g. via `renderer.registerPipeline`) so the recorder can look up the
   * pipeline. Also adopts the cached pipeline for bind-group creation.
   */
  public setPipelineKey(key: string, pipeline: GPURenderPipeline): void {
    this.pipelineKey = key;
    this.pipeline = pipeline;
    // Re-create bind groups from the new pipeline's bind group layouts.
    const bgl1 = pipeline.getBindGroupLayout(1);
    this.atmosphereBindGroup = this.device.createBindGroup({
      layout: bgl1,
      entries: [{ binding: 0, resource: { buffer: this.atmosphereBuffer } }],
      label: 'atmosphere:sky-bindgroup1',
    });
    this.cameraBindGroup = null;
    this.cameraBufferRef = null;
  }

  /** The WGSL source for the sky shader. */
  public static get shaderSource(): string {
    return SKY_SHADER_SOURCE;
  }

  /** The vertex layout for the sky full-screen triangle. */
  public static get vertexLayout(): VertexLayout {
    return SKY_VERTEX_LAYOUT;
  }

  /** Build the sky render pipeline with depth-write disabled and always-test. */
  private buildPipeline(): GPURenderPipeline {
    const shaderModule = this.device.createShaderModule({ code: SKY_SHADER_SOURCE });
    return this.device.createRenderPipeline({
      label: DEFAULT_PIPELINE_KEY,
      layout: 'auto',
      vertex: {
        module: shaderModule,
        entryPoint: 'vs_main',
        buffers: [
          {
            arrayStride: SKY_VERTEX_LAYOUT.stride,
            stepMode: SKY_VERTEX_LAYOUT.stepMode,
            attributes: SKY_VERTEX_LAYOUT.attributes.map((a) => ({
              shaderLocation: a.shaderLocation,
              offset: a.offset,
              format: a.format,
            })),
          },
        ],
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fs_main',
        targets: [{ format: this.format }],
      },
      primitive: { topology: 'triangle-list' },
      depthStencil: {
        format: this.depthFormat,
        depthCompare: 'always',
        depthWriteEnabled: false,
      },
      multisample: { count: this.sampleCount },
    });
  }
}

// ---- Helpers --------------------------------------------------------------

function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function lerp3(a: Vec3, b: Vec3, t: number): Vec3 {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  };
}

// ---- WGSL shader ----------------------------------------------------------
//
// The sky shader reads the camera uniform (group 0) and the atmosphere uniform
// (group 1). The vertex shader passes through NDC xy; the fragment shader
// reconstructs the view-space ray direction from the projection matrix and
// computes a horizon→zenith gradient plus a sun/moon disc.
const SKY_SHADER_SOURCE = /* wgsl */`struct CameraUniform {
  viewProj  : mat4x4<f32>,
  view      : mat4x4<f32>,
  proj      : mat4x4<f32>,
  cameraPos : vec3<f32>,
  time      : f32,
  _pad      : f32,
};

struct AtmosphereUniform {
  sunDirection : vec4<f32>,
  sunColor     : vec4<f32>,
  ambientColor : vec4<f32>,
  fogColor     : vec4<f32>,
  fogNear      : f32,
  fogFar       : f32,
  time         : f32,
  _pad         : f32,
};

@group(0) @binding(0) var<uniform> camera : CameraUniform;
@group(1) @binding(0) var<uniform> atmosphere : AtmosphereUniform;

struct VOut {
  @builtin(position) position : vec4<f32>,
  @location(0) ndc : vec2<f32>,
};

@vertex
fn vs_main(@location(0) pos : vec2<f32>) -> VOut {
  var out : VOut;
  out.position = vec4<f32>(pos, 0.0, 1.0);
  out.ndc = pos;
  return out;
}

@fragment
fn fs_main(in : VOut) -> @location(0) vec4<f32> {
  // Reconstruct the view-space ray direction from NDC using the projection
  // matrix. proj[0].x = p00, proj[1].y = p11. The near plane maps to z=0 in
  // WebGPU NDC; the view-space ray points along -z.
  let p00 = camera.proj[0].x;
  let p11 = camera.proj[1].y;
  var ray = vec3<f32>(in.ndc.x / p00, in.ndc.y / p11, -1.0);
  ray = normalize(ray);

  // Transform the sun direction (world space) into view space.
  let sunDirWorld = normalize(atmosphere.sunDirection.xyz);
  let sunDirView = normalize((camera.view * vec4<f32>(sunDirWorld, 0.0)).xyz);
  // Moon is opposite the sun.
  let moonDirView = normalize((camera.view * vec4<f32>(-sunDirWorld, 0.0)).xyz);

  // Sun height in world space: > 0 = day, < 0 = night.
  let sunHeight = sunDirWorld.y;
  let dayFactor = clamp(sunHeight * 1.5 + 0.2, 0.0, 1.0);

  // Sky gradient: horizon → zenith based on the ray's up component.
  let upFactor = clamp(ray.y, 0.0, 1.0);
  let zenithColor = vec3<f32>(0.25, 0.45, 0.8);
  let horizonColor = atmosphere.fogColor.xyz;
  let nightColor = vec3<f32>(0.02, 0.03, 0.06);

  let daySky = mix(horizonColor, zenithColor, pow(upFactor, 0.6));
  let skyColor = mix(nightColor, daySky, dayFactor);

  // Warm sunrise/sunset glow near the sun when it is low.
  let sunsetFactor = clamp(1.0 - abs(sunHeight) * 3.0, 0.0, 1.0);
  let sunInfluence = clamp(dot(ray, sunDirView), 0.0, 1.0);
  let warmColor = vec3<f32>(1.0, 0.6, 0.3);
  let warmGlow = warmColor * pow(sunInfluence, 4.0) * sunsetFactor * 0.6;

  // Sun disc (visible during day / near horizon).
  let cosSun = dot(ray, sunDirView);
  let sunDisc = smoothstep(0.9975, 0.9995, cosSun);
  let sunDiscColor = atmosphere.sunColor.xyz * sunDisc * clamp(dayFactor + 0.1, 0.0, 1.0);

  // Moon disc (visible at night).
  let cosMoon = dot(ray, moonDirView);
  let moonDisc = smoothstep(0.9975, 0.9995, cosMoon);
  let moonColor = vec3<f32>(0.8, 0.8, 0.9);
  let moonDiscColor = moonColor * moonDisc * (1.0 - dayFactor) * 0.8;

  let color = skyColor + warmGlow + sunDiscColor + moonDiscColor;
  return vec4<f32>(color, 1.0);
}
`;
