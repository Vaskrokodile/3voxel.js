/**
 * Reusable WGSL shader chunks and a composable shader builder.
 *
 * Instead of monolithic hand-written shaders, tdjs builds its WGSL programs
 * from named {@link ShaderChunk}s. Each chunk is a small piece of shader code
 * (a struct, a function, a binding) that declares the chunks it depends on.
 * {@link buildShader} resolves the dependency graph and emits each chunk at
 * most once, in dependency order, producing a complete WGSL source string.
 *
 * The chunks mirror the engine's CPU-side uniform layouts exactly:
 *   - {@link CameraUniformData} (224 bytes) — see `src/renderer/UniformBuffer.ts`.
 *   - {@link AtmosphereUniformData} (80 bytes) — see `src/atmosphere/AtmosphereUniforms.ts`.
 *   - The 36-byte voxel vertex stride — see `src/meshing/VertexLayout.ts`.
 */

/** A WGSL shader chunk — a piece of reusable shader code. */
export interface ShaderChunk {
  /** Stable name used to reference this chunk from `buildShader` / dependencies. */
  readonly name: string;
  /** Raw WGSL source for this chunk. */
  readonly source: string;
  /** Names of chunks that must be emitted before this one. */
  readonly dependencies?: readonly string[];
}

/** Internal registry of all known chunks (built-in + custom). */
const REGISTRY = new Map<string, ShaderChunk>();

/** The water block id used by `water_effect` (overridable via `setWaterId`). */
let WATER_ID: number = 8;

/**
 * Set the block id used by the `water_effect` chunk's `WATER_ID_U32` constant.
 * Call before {@link buildShader} / {@link MaterialSystem} construction if your
 * world uses a non-default water block id.
 */
export function setWaterId(id: number): void {
  WATER_ID = id;
}

/** Built-in camera uniform struct chunk (mirrors `CameraUniformData`). */
const CAMERA_UNIFORM: ShaderChunk = {
  name: 'camera_uniform',
  source: `struct CameraUniform {
  viewProj   : mat4x4<f32>,
  view       : mat4x4<f32>,
  proj       : mat4x4<f32>,
  cameraPos  : vec4<f32>,
  time       : f32,
  _pad       : f32,
};`,
};

/** Built-in atmosphere uniform struct chunk (mirrors `AtmosphereUniformData`). */
const ATMOSPHERE_UNIFORM: ShaderChunk = {
  name: 'atmosphere_uniform',
  source: `struct AtmosphereUniform {
  sunDirection : vec4<f32>,
  sunColor     : vec4<f32>,
  ambientColor : vec4<f32>,
  fogColor     : vec4<f32>,
  fogNear      : f32,
  fogFar       : f32,
  time         : f32,
  _pad2        : f32,
};`,
};

/** 16-entry color lookup table (per-block base colors). */
const COLOR_TABLE: ShaderChunk = {
  name: 'color_table',
  source: `struct ColorTable {
  colors : array<vec4<f32>, 16>,
};`,
};

/** Voxel vertex input struct matching the 36-byte mesher stride. */
const VOXEL_VERTEX_INPUT: ShaderChunk = {
  name: 'voxel_vertex_input',
  source: `struct VertexInput {
  @location(0) position : vec3<f32>,
  @location(1) normal   : vec3<f32>,
  @location(2) packed   : u32,
  @location(3) uv       : vec2<f32>,
};`,
};

/** Voxel vertex output struct (interpolated to the fragment stage). */
const VOXEL_VERTEX_OUTPUT: ShaderChunk = {
  name: 'voxel_vertex_output',
  source: `struct VertexOutput {
  @builtin(position) clipPos : vec4<f32>,
  @location(0) normal   : vec3<f32>,
  @location(1) worldPos : vec3<f32>,
  @location(2) @interpolate(flat) packed : u32,
};`,
};

/** Defines the `WATER_ID_U32` constant used by `water_effect`. */
const WATER_ID_CONST: ShaderChunk = {
  name: 'water_id_const',
  source: `const WATER_ID_U32 = ${WATER_ID}u;`,
};

/** Fog mixing function (references `camera` and `atmosphere` uniforms). */
const APPLY_FOG: ShaderChunk = {
  name: 'apply_fog',
  source: `fn applyFog(color: vec3<f32>, worldPos: vec3<f32>) -> vec3<f32> {
  let dist = distance(worldPos, camera.cameraPos.xyz);
  let range = max(atmosphere.fogFar - atmosphere.fogNear, 0.001);
  let distFactor = 1.0 - exp(-max(dist - atmosphere.fogNear, 0.0) / range);
  let heightDensity = exp(-max(worldPos.y, 0.0) * 0.02);
  let heightFactor = (1.0 - exp(-dist * 0.01)) * heightDensity;
  let factor = clamp(max(distFactor, heightFactor * 0.5), 0.0, 1.0);
  return mix(color, atmosphere.fogColor.xyz, factor);
}`,
  dependencies: ['camera_uniform', 'atmosphere_uniform'],
};

/** Sun + ambient lighting function (references `atmosphere` uniform). */
const SUN_LIGHTING: ShaderChunk = {
  name: 'sun_lighting',
  source: `fn sunLighting(normal: vec3<f32>, baseColor: vec3<f32>, ao: f32) -> vec3<f32> {
  let sunDir = normalize(atmosphere.sunDirection.xyz);
  let ndotl = max(dot(normal, sunDir), 0.0);
  let sun = atmosphere.sunColor.xyz * ndotl;
  let ambient = atmosphere.ambientColor.xyz;
  let aoFactor = 0.4 + 0.6 * ao;
  return baseColor * (ambient + sun) * aoFactor;
}`,
  dependencies: ['atmosphere_uniform'],
};

/** Block id / AO unpacking helpers for the packed vertex attribute. */
const UNPACK_BLOCK: ShaderChunk = {
  name: 'unpack_block',
  source: `fn unpackBlockId(packed: u32) -> u32 { return (packed >> 16u) & 0xFFFFu; }
fn unpackAO(packed: u32) -> f32 { return f32(packed & 0xFFu) / 3.0; }`,
};

/** Water alpha selection (depends on the `water_id_const` chunk). */
const WATER_EFFECT: ShaderChunk = {
  name: 'water_effect',
  source: `fn waterAlpha(blockId: u32) -> f32 {
  return select(1.0, 0.6, blockId == WATER_ID_U32);
}`,
  dependencies: ['water_id_const'],
};

const WATER_UNIFORM: ShaderChunk = {
  name: 'water_uniform',
  source: `struct WaterUniform {
  waterColor    : vec4<f32>,
  waterDepth    : f32,
  waveAmplitude : f32,
  time          : f32,
  _pad          : f32,
};`,
};

const WATER_VERTEX_OUTPUT: ShaderChunk = {
  name: 'water_vertex_output',
  source: `struct WaterVertexOutput {
  @builtin(position) clipPos : vec4<f32>,
  @location(0) normal   : vec3<f32>,
  @location(1) worldPos : vec3<f32>,
  @location(2) @interpolate(flat) packed : u32,
  @location(3) uv       : vec2<f32>,
};`,
};

const WATER_SURFACE: ShaderChunk = {
  name: 'water_surface',
  source: `fn waterSurfaceColor(baseColor: vec3<f32>, normal: vec3<f32>, worldPos: vec3<f32>, uv: vec2<f32>) -> vec3<f32> {
  let t = water.time;
  let scrollUv = uv + vec2<f32>(t * 0.05, t * 0.03);
  let shimmer = (sin(scrollUv.x * 8.0) * cos(scrollUv.y * 8.0)) * 0.5 + 0.5;
  let viewDir = normalize(camera.cameraPos.xyz - worldPos);
  let fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 3.0);
  let waterCol = water.waterColor.xyz;
  let depthFade = clamp(water.waterDepth, 0.0, 1.0);
  let tinted = mix(baseColor, waterCol, 0.5 * depthFade);
  let shimmerBright = shimmer * 0.15;
  let edgeBright = fresnel * 0.5;
  return tinted + shimmerBright + edgeBright;
}
fn waterSurfaceAlpha(blockId: u32, normal: vec3<f32>, worldPos: vec3<f32>) -> f32 {
  let base = waterAlpha(blockId);
  if (blockId != WATER_ID_U32) { return base; }
  let viewDir = normalize(camera.cameraPos.xyz - worldPos);
  let fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 3.0);
  return mix(0.6, 0.9, fresnel);
}`,
  dependencies: ['water_uniform', 'camera_uniform', 'water_id_const', 'water_effect'],
};

const STAR_HASH: ShaderChunk = {
  name: 'star_hash',
  source: `fn hash33(p: vec3<f32>) -> vec3<f32> {
  let q = vec3<f32>(dot(p, vec3<f32>(127.1, 311.7, 74.7)),
                   dot(p, vec3<f32>(269.5, 183.3, 246.1)),
                   dot(p, vec3<f32>(113.5, 271.9, 124.6)));
  return fract(sin(q) * 43758.5453);
}`,
};

/** All built-in chunks, keyed by name. */
export const CHUNKS: Record<string, ShaderChunk> = {
  camera_uniform: CAMERA_UNIFORM,
  atmosphere_uniform: ATMOSPHERE_UNIFORM,
  color_table: COLOR_TABLE,
  voxel_vertex_input: VOXEL_VERTEX_INPUT,
  voxel_vertex_output: VOXEL_VERTEX_OUTPUT,
  water_id_const: WATER_ID_CONST,
  apply_fog: APPLY_FOG,
  sun_lighting: SUN_LIGHTING,
  unpack_block: UNPACK_BLOCK,
  water_effect: WATER_EFFECT,
  water_uniform: WATER_UNIFORM,
  water_vertex_output: WATER_VERTEX_OUTPUT,
  water_surface: WATER_SURFACE,
  star_hash: STAR_HASH,
};

// Seed the runtime registry with the built-in chunks.
for (const chunk of Object.values(CHUNKS)) {
  REGISTRY.set(chunk.name, chunk);
}

/**
 * Register a custom chunk (or override a built-in one).
 *
 * @param chunk The chunk to register. A chunk with the same `name` replaces the
 *   previous entry.
 */
export function registerChunk(chunk: ShaderChunk): void {
  REGISTRY.set(chunk.name, chunk);
}

/** Look up a chunk by name (built-in or custom). */
export function getChunk(name: string): ShaderChunk | undefined {
  return REGISTRY.get(name);
}

/**
 * Resolve the full, dependency-ordered, de-duplicated list of chunk names for
 * the given requested names. Throws if a requested or dependency name is not
 * registered.
 */
function resolveOrder(requested: readonly string[]): string[] {
  const ordered: string[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  const visit = (name: string): void => {
    if (visited.has(name)) return;
    if (visiting.has(name)) {
      throw new ShaderError(`Circular chunk dependency involving '${name}'.`);
    }
    const chunk = REGISTRY.get(name);
    if (chunk === undefined) {
      throw new ShaderError(`Unknown shader chunk '${name}'.`);
    }
    visiting.add(name);
    for (const dep of chunk.dependencies ?? []) {
      visit(dep);
    }
    visiting.delete(name);
    visited.add(name);
    ordered.push(name);
  };

  for (const name of requested) {
    visit(name);
  }
  return ordered;
}

/**
 * Build a complete WGSL shader from named chunks.
 *
 * Dependencies are emitted before dependents; each chunk appears at most once
 * even if requested (directly or transitively) multiple times. The `WATER_ID_U32`
 * constant is substituted with the current value set via {@link setWaterId}.
 *
 * @param chunkNames Chunks to include (dependencies are pulled in automatically).
 * @returns Concatenated WGSL source.
 */
export function buildShader(chunkNames: string[]): string {
  const ordered = resolveOrder(chunkNames);
  const parts: string[] = [];
  for (const name of ordered) {
    const chunk = REGISTRY.get(name);
    // Guaranteed by resolveOrder, but satisfy noUncheckedIndexedAccess / TS.
    if (chunk === undefined) continue;
    let src = chunk.source;
    if (name === 'water_id_const') {
      // Re-render with the current water id so setWaterId takes effect.
      src = `const WATER_ID_U32 = ${WATER_ID}u;`;
    }
    parts.push(`// chunk: ${name}\n${src}`);
  }
  return parts.join('\n\n') + '\n';
}

/** Typed error thrown by the shader library. */
export class ShaderError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ShaderError';
  }
}
