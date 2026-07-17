/**
 * Material definitions for different block / object types.
 *
 * A {@link Material} bundles a complete WGSL vertex + fragment shader pair with
 * the fixed-function pipeline state (blend mode, depth write, cull mode) needed
 * to render it. Built-in materials are assembled from {@link CHUNKS} via
 * {@link ShaderBuilder}; custom materials can be registered with
 * {@link MaterialSystem.register}.
 */

import { ShaderBuilder } from './ShaderBuilder.js';

/** How a material's fragment output blends with the framebuffer. */
export type BlendMode = 'opaque' | 'transparent' | 'additive';

/** Face culling mode. */
export type CullMode = 'none' | 'front' | 'back';

/** A renderable material: shaders + fixed-function state. */
export interface Material {
  /** Stable name (used for lookup and debugging). */
  readonly name: string;
  /** Complete WGSL source containing the `vs_main` entry point. */
  readonly vertexShader: string;
  /** Complete WGSL source containing the `fs_main` entry point. */
  readonly fragmentShader: string;
  /** Blend mode driving `GPUColorTargetState.blend`. */
  readonly blendMode: BlendMode;
  /** Whether depth is written for this material. */
  readonly depthWrite: boolean;
  /** Face culling. */
  readonly cullMode: CullMode;
}

/** Registry of named materials (built-in + custom). */
const REGISTRY = new Map<string, Material>();

// ---- Opaque voxel shader -------------------------------------------------

const OPAQUE_VERTEX = new ShaderBuilder()
  .include('camera_uniform')
  .include('voxel_vertex_input')
  .include('voxel_vertex_output')
  .addBinding(0, 0, 'camera', 'CameraUniform', 'uniform')
  .setVertexFunction(
    `@vertex fn vs_main(input : VertexInput) -> VertexOutput {
  var output : VertexOutput;
  output.worldPos = input.position;
  output.clipPos = camera.viewProj * vec4<f32>(input.position, 1.0);
  output.normal = input.normal;
  output.packed = input.packed;
  return output;
}`,
  )
  .build();

const OPAQUE_FRAGMENT = new ShaderBuilder()
  .include('atmosphere_uniform')
  .include('color_table')
  .include('unpack_block')
  .include('sun_lighting')
  .include('apply_fog')
  .addBinding(0, 0, 'camera', 'CameraUniform', 'uniform')
  .addBinding(1, 0, 'atmosphere', 'AtmosphereUniform', 'uniform')
  .addBinding(1, 1, 'colorTable', 'ColorTable', 'uniform')
  .setFragmentFunction(
    `@fragment fn fs_main(input : VertexOutput) -> @location(0) vec4<f32> {
  let blockId = unpackBlockId(input.packed);
  let ao = unpackAO(input.packed);
  let baseColor = colorTable.colors[blockId].xyz;
  let lit = sunLighting(input.normal, baseColor, ao);
  let fogged = applyFog(lit, input.worldPos);
  return vec4<f32>(fogged, 1.0);
}`,
  )
  .build();

// ---- Transparent (water) voxel shader ------------------------------------

const TRANSPARENT_FRAGMENT = new ShaderBuilder()
  .include('atmosphere_uniform')
  .include('color_table')
  .include('unpack_block')
  .include('sun_lighting')
  .include('apply_fog')
  .include('water_effect')
  .addBinding(0, 0, 'camera', 'CameraUniform', 'uniform')
  .addBinding(1, 0, 'atmosphere', 'AtmosphereUniform', 'uniform')
  .addBinding(1, 1, 'colorTable', 'ColorTable', 'uniform')
  .setFragmentFunction(
    `@fragment fn fs_main(input : VertexOutput) -> @location(0) vec4<f32> {
  let blockId = unpackBlockId(input.packed);
  let ao = unpackAO(input.packed);
  let baseColor = colorTable.colors[blockId].xyz;
  let lit = sunLighting(input.normal, baseColor, ao);
  let fogged = applyFog(lit, input.worldPos);
  return vec4<f32>(fogged, waterAlpha(blockId));
}`,
  )
  .build();

const TRANSPARENT_VERTEX = new ShaderBuilder()
  .include('camera_uniform')
  .include('voxel_vertex_input')
  .include('voxel_vertex_output')
  .addBinding(0, 0, 'camera', 'CameraUniform', 'uniform')
  .setVertexFunction(
    `@vertex fn vs_main(input : VertexInput) -> VertexOutput {
  var output : VertexOutput;
  output.worldPos = input.position;
  output.clipPos = camera.viewProj * vec4<f32>(input.position, 1.0);
  output.normal = input.normal;
  output.packed = input.packed;
  return output;
}`,
  )
  .build();

// ---- Wireframe shader (unlit, constant color) ----------------------------

const WIREFRAME_VERTEX = new ShaderBuilder()
  .include('camera_uniform')
  .include('voxel_vertex_input')
  .setVertexFunction(
    `struct WireOutput {
  @builtin(position) clipPos : vec4<f32>,
};
@vertex fn vs_main(input : VertexInput) -> WireOutput {
  var output : WireOutput;
  output.clipPos = camera.viewProj * vec4<f32>(input.position, 1.0);
  return output;
}`,
  )
  .addBinding(0, 0, 'camera', 'CameraUniform', 'uniform')
  .build();

const WIREFRAME_FRAGMENT = `@fragment fn fs_main() -> @location(0) vec4<f32> {
  return vec4<f32>(1.0, 1.0, 1.0, 1.0);
}
`;

// ---- Sky shader ----------------------------------------------------------

const SKY_VERTEX = new ShaderBuilder()
  .include('camera_uniform')
  .include('voxel_vertex_input')
  .setVertexFunction(
    `struct SkyOutput {
  @builtin(position) clipPos : vec4<f32>,
  @location(0) worldPos : vec3<f32>,
};
@vertex fn vs_main(input : VertexInput) -> SkyOutput {
  var output : SkyOutput;
  output.worldPos = input.position;
  output.clipPos = camera.viewProj * vec4<f32>(input.position, 1.0);
  return output;
}`,
  )
  .addBinding(0, 0, 'camera', 'CameraUniform', 'uniform')
  .build();

const SKY_FRAGMENT = new ShaderBuilder()
  .include('atmosphere_uniform')
  .setFragmentFunction(
    `@fragment fn fs_main(@location(0) worldPos : vec3<f32>) -> @location(0) vec4<f32> {
  let dir = normalize(worldPos - camera.cameraPos.xyz);
  let up = vec3<f32>(0.0, 1.0, 0.0);
  let t = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
  let sky = mix(atmosphere.fogColor.xyz, atmosphere.ambientColor.xyz, t);
  return vec4<f32>(sky, 1.0);
}`,
  )
  .addBinding(0, 0, 'camera', 'CameraUniform', 'uniform')
  .addBinding(1, 0, 'atmosphere', 'AtmosphereUniform', 'uniform')
  .build();

/** Built-in opaque voxel material (lit, fogged, depth-writing, back-face culled). */
export const OPAQUE_VOXEL: Material = {
  name: 'opaque_voxel',
  vertexShader: OPAQUE_VERTEX,
  fragmentShader: OPAQUE_FRAGMENT,
  blendMode: 'opaque',
  depthWrite: true,
  cullMode: 'back',
};

/** Built-in transparent voxel material (water/glass; alpha from `waterAlpha`). */
export const TRANSPARENT_VOXEL: Material = {
  name: 'transparent_voxel',
  vertexShader: TRANSPARENT_VERTEX,
  fragmentShader: TRANSPARENT_FRAGMENT,
  blendMode: 'transparent',
  depthWrite: false,
  cullMode: 'none',
};

/** Built-in wireframe material (unlit white lines). */
export const WIREFRAME: Material = {
  name: 'wireframe',
  vertexShader: WIREFRAME_VERTEX,
  fragmentShader: WIREFRAME_FRAGMENT,
  blendMode: 'opaque',
  depthWrite: true,
  cullMode: 'none',
};

/** Built-in sky material (gradient from fog to ambient based on view direction). */
export const SKY: Material = {
  name: 'sky',
  vertexShader: SKY_VERTEX,
  fragmentShader: SKY_FRAGMENT,
  blendMode: 'opaque',
  depthWrite: false,
  cullMode: 'none',
};

/**
 * Registry of materials. Built-ins are exposed as static constants and
 * pre-registered by name; custom materials can be added via
 * {@link MaterialSystem.register}.
 */
export class MaterialSystem {
  /** Built-in opaque voxel material. */
  public static readonly OPAQUE_VOXEL: Material = OPAQUE_VOXEL;
  /** Built-in transparent voxel material. */
  public static readonly TRANSPARENT_VOXEL: Material = TRANSPARENT_VOXEL;
  /** Built-in wireframe material. */
  public static readonly WIREFRAME: Material = WIREFRAME;
  /** Built-in sky material. */
  public static readonly SKY: Material = SKY;

  static {
    REGISTRY.set(OPAQUE_VOXEL.name, OPAQUE_VOXEL);
    REGISTRY.set(TRANSPARENT_VOXEL.name, TRANSPARENT_VOXEL);
    REGISTRY.set(WIREFRAME.name, WIREFRAME);
    REGISTRY.set(SKY.name, SKY);
  }

  /**
   * Register a custom material by name (replaces an existing entry with the
   * same name).
   */
  public static register(name: string, material: Material): void {
    REGISTRY.set(name, material);
  }

  /** Look up a material by name, or `null` if not registered. */
  public static get(name: string): Material | null {
    return REGISTRY.get(name) ?? null;
  }
}
