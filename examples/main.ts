/**
 * Game demo — a first-person voxel survival sandbox.
 *
 * Integrates ALL tdjs subsystems:
 *   - WebGPU renderer with sky dome, sun lighting, distance fog
 *   - Procedural terrain with biomes, trees, ore veins
 *   - Physics: gravity, AABB collision, walking, jumping
 *   - Block interaction: raycast targeting, break/place, selection highlight
 *   - Day/night cycle with dynamic sky and lighting
 *   - Hotbar with 9 block slots
 *
 * Controls:
 *   WASD       — move
 *   Space      — jump / ascend (fly)
 *   Shift      — sprint / descend (fly)
 *   Ctrl       — crouch / descend (fly)
 *   Mouse      — look
 *   Left click — break block
 *   Right click — place block
 *   1-9        — select hotbar slot
 *   F          — toggle fly mode
 *   Click      — lock pointer
 *   Esc        — release pointer
 */

import {
  CHUNK_SIZE,
  CHUNK_VOLUME,
  AIR,
  type BlockId,
  type ChunkCoord,
  type ChunkMeshData,
  type Vec3,
  chunkKey,
} from '../src/core/types.js';
import {
  mat4,
  mat4Perspective,
  mat4LookAt,
  mat4Multiply,
  vec3Normalize,
} from '../src/core/math/index.js';
import { Renderer, type VertexLayout, type CameraUniformData } from '../src/renderer/index.js';
import { BlockRegistry, VoxelWorld, Chunk } from '../src/voxel/index.js';
import { GreedyMesher } from '../src/meshing/GreedyMesher.js';
import type { BlockRegistryLike, VoxelChunkLike } from '../src/meshing/types.js';
import { World, type ChunkSerializer, type WorkerPoolLike } from '../src/world/index.js';
import { TerrainGenerator } from '../src/generation/TerrainGenerator.js';
import { TerrainFeatures } from '../src/generation/TerrainFeatures.js';
import { Camera } from '../src/camera/index.js';
import { InputManager } from '../src/input/index.js';
import { VoxelCollider, RigidBody, PlayerController } from '../src/physics/index.js';
import { VoxelRaycaster, BlockEditor, SelectionHighlight } from '../src/interaction/index.js';
import {
  SkyRenderer,
  DayNightCycle,
  AtmosphereUniformWriter,
  ATMOSPHERE_UNIFORM_SIZE,
  type AtmosphereUniformData,
} from '../src/atmosphere/index.js';

// ---- DOM helpers ------------------------------------------------------------

function setText(id: string, value: string): void {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function showError(msg: string): void {
  console.error('TDJS ERROR:', msg);
  const overlay = document.getElementById('overlay')!;
  overlay.innerHTML = `
    <h1 style="color:#f85149">ERROR</h1>
    <textarea readonly style="width:600px;height:200px;font-size:11px;color:#f85149;background:#1a1a2e;border:1px solid #f85149;padding:8px;white-space:pre-wrap;word-break:break-word;font-family:monospace">${msg.replace(/</g, '&lt;')}</textarea>
    <div style="margin-top:8px;color:#8b949e;font-size:11px">↑ Ctrl+A then Ctrl+C to copy</div>
  `;
  (window as unknown as { __tdjsError?: string }).__tdjsError = msg;
}

// ---- Block registry ---------------------------------------------------------

const registry = new BlockRegistry();
const BLOCK_DEFS = [
  { name: 'stone', solid: true, transparent: false, opaqueFaces: true, color: [0.5, 0.5, 0.52], meshType: 'cube' as const },
  { name: 'dirt', solid: true, transparent: false, opaqueFaces: true, color: [0.45, 0.32, 0.22], meshType: 'cube' as const },
  { name: 'grass', solid: true, transparent: false, opaqueFaces: true, color: [0.3, 0.58, 0.25], meshType: 'cube' as const },
  { name: 'sand', solid: true, transparent: false, opaqueFaces: true, color: [0.76, 0.7, 0.45], meshType: 'cube' as const },
  { name: 'water', solid: false, transparent: true, opaqueFaces: false, color: [0.2, 0.4, 0.8], meshType: 'cube' as const },
  { name: 'snow', solid: true, transparent: false, opaqueFaces: true, color: [0.9, 0.9, 0.95], meshType: 'cube' as const },
  { name: 'log', solid: true, transparent: false, opaqueFaces: true, color: [0.4, 0.28, 0.15], meshType: 'cube' as const },
  { name: 'leaves', solid: true, transparent: false, opaqueFaces: false, color: [0.2, 0.45, 0.2], meshType: 'cube' as const },
  { name: 'coal_ore', solid: true, transparent: false, opaqueFaces: true, color: [0.3, 0.3, 0.3], meshType: 'cube' as const },
  { name: 'iron_ore', solid: true, transparent: false, opaqueFaces: true, color: [0.6, 0.5, 0.4], meshType: 'cube' as const },
  { name: 'gold_ore', solid: true, transparent: false, opaqueFaces: true, color: [0.8, 0.7, 0.2], meshType: 'cube' as const },
  { name: 'diamond_ore', solid: true, transparent: false, opaqueFaces: true, color: [0.3, 0.8, 0.9], meshType: 'cube' as const },
  { name: 'cactus', solid: true, transparent: false, opaqueFaces: false, color: [0.3, 0.5, 0.25], meshType: 'cube' as const },
  { name: 'planks', solid: true, transparent: false, opaqueFaces: true, color: [0.65, 0.5, 0.3], meshType: 'cube' as const },
  { name: 'glass', solid: true, transparent: true, opaqueFaces: false, color: [0.7, 0.8, 0.9], meshType: 'cube' as const },
  { name: 'brick', solid: true, transparent: false, opaqueFaces: true, color: [0.6, 0.3, 0.25], meshType: 'cube' as const },
];
for (const def of BLOCK_DEFS) {
  registry.register(def);
}

// Hotbar: block names the player can place.
const HOTBAR = [
  'stone', 'dirt', 'grass', 'sand', 'log',
  'leaves', 'planks', 'glass', 'brick',
];
const HOTBAR_IDS = HOTBAR.map((n) => registry.getByName(n)!.id);

// Color table for the shader (16 slots, indexed by block id).
const COLOR_COUNT = 16;
const colorData = new Float32Array(COLOR_COUNT * 4);
for (let i = 0; i < COLOR_COUNT; i++) {
  const bt = registry.get(i);
  const c = bt?.color ?? [1, 0, 1];
  colorData[i * 4] = c[0];
  colorData[i * 4 + 1] = c[1];
  colorData[i * 4 + 2] = c[2];
  colorData[i * 4 + 3] = 1;
}

const WATER_ID = registry.getByName('water')!.id;

// ---- WGSL shaders -----------------------------------------------------------

const VOXEL_VERTEX_LAYOUT: VertexLayout = {
  stride: 36,
  stepMode: 'vertex',
  attributes: [
    { name: 'position', shaderLocation: 0, format: 'float32x3', offset: 0 },
    { name: 'normal', shaderLocation: 1, format: 'float32x3', offset: 12 },
    { name: 'packed', shaderLocation: 2, format: 'uint32', offset: 24 },
    { name: 'uv', shaderLocation: 3, format: 'float32x2', offset: 28 },
  ],
};

const WORLD_WGSL = /* wgsl */ `
struct CameraUniform {
  viewProj   : mat4x4<f32>,
  view       : mat4x4<f32>,
  proj       : mat4x4<f32>,
  cameraPos  : vec4<f32>,
  time       : f32,
  _pad       : f32,
};

struct AtmosphereUniform {
  sunDirection : vec4<f32>,
  sunColor     : vec4<f32>,
  ambientColor : vec4<f32>,
  fogColor     : vec4<f32>,
  fogNear      : f32,
  fogFar       : f32,
  time         : f32,
  _pad2        : f32,
};

struct ColorTable {
  colors : array<vec4<f32>, 16>,
};

@group(0) @binding(0) var<uniform> camera : CameraUniform;
@group(0) @binding(1) var<uniform> colorTable : ColorTable;
@group(1) @binding(0) var<uniform> atmosphere : AtmosphereUniform;

struct VertexInput {
  @location(0) position : vec3<f32>,
  @location(1) normal   : vec3<f32>,
  @location(2) packed   : u32,
  @location(3) uv       : vec2<f32>,
};

struct VertexOutput {
  @builtin(position) clipPos : vec4<f32>,
  @location(0) normal   : vec3<f32>,
  @location(1) worldPos : vec3<f32>,
  @location(2) @interpolate(flat) packed : u32,
};

@vertex
fn vs_main(in : VertexInput) -> VertexOutput {
  var out : VertexOutput;
  out.clipPos = camera.viewProj * vec4<f32>(in.position, 1.0);
  out.normal = in.normal;
  out.worldPos = in.position;
  out.packed = in.packed;
  return out;
}

fn applyFog(color: vec3<f32>, worldPos: vec3<f32>) -> vec3<f32> {
  let dist = distance(worldPos, camera.cameraPos.xyz);
  let factor = clamp((dist - atmosphere.fogNear) / (atmosphere.fogFar - atmosphere.fogNear), 0.0, 1.0);
  return mix(color, atmosphere.fogColor.xyz, factor);
}

@fragment
fn fs_main(in : VertexOutput) -> @location(0) vec4<f32> {
  let blockId = (in.packed >> 16u) & 0xFFFFu;
  let ao = f32(in.packed & 0xFFu) / 3.0;
  let aoFactor = 0.4 + 0.6 * ao;

  if (blockId >= 16u) {
    return vec4<f32>(1.0, 0.0, 1.0, 1.0);
  }

  let baseColor = colorTable.colors[blockId].rgb;
  let n = normalize(in.normal);
  let sunDir = normalize(atmosphere.sunDirection.xyz);
  let ndotl = max(dot(n, sunDir), 0.0);
  let sunLight = atmosphere.sunColor.xyz * ndotl;
  let ambient = atmosphere.ambientColor.xyz;
  let lighting = ambient + sunLight;
  var color = baseColor * lighting * aoFactor;

  // Apply fog.
  color = applyFog(color, in.worldPos);

  // Water is semi-transparent.
  let alpha = select(1.0, 0.6, blockId == ${WATER_ID}u);
  return vec4<f32>(color, alpha);
}
`;

// Line shader for the selection highlight.
const LINE_WGSL = /* wgsl */ `
struct CameraUniform {
  viewProj   : mat4x4<f32>,
  view       : mat4x4<f32>,
  proj       : mat4x4<f32>,
  cameraPos  : vec4<f32>,
  time       : f32,
  _pad       : f32,
};

@group(0) @binding(0) var<uniform> camera : CameraUniform;

@vertex
fn vs_main(@location(0) position : vec3<f32>) -> @builtin(position) vec4<f32> {
  return camera.viewProj * vec4<f32>(position, 1.0);
}

@fragment
fn fs_main() -> @location(0) vec4<f32> {
  return vec4<f32>(0.0, 0.0, 0.0, 0.8);
}
`;

const LINE_VERTEX_LAYOUT: VertexLayout = {
  stride: 12,
  stepMode: 'vertex',
  attributes: [
    { name: 'position', shaderLocation: 0, format: 'float32x3', offset: 0 },
  ],
};

// ---- Chunk serializer -------------------------------------------------------

const chunkSerializer: ChunkSerializer = {
  serialize(chunk) {
    const palette = (chunk as Chunk).palette;
    const paletteSize = palette.size;
    const paletteIds = new Uint8Array(paletteSize);
    for (let i = 0; i < paletteSize; i++) {
      paletteIds[i] = palette.getId(i);
    }
    const blocks = new Uint8Array(CHUNK_VOLUME);
    for (let ly = 0; ly < CHUNK_SIZE; ly++) {
      for (let lz = 0; lz < CHUNK_SIZE; lz++) {
        for (let lx = 0; lx < CHUNK_SIZE; lx++) {
          const id = chunk.getBlock(lx, ly, lz);
          const idx = lx + lz * CHUNK_SIZE + ly * CHUNK_SIZE * CHUNK_SIZE;
          blocks[idx] = palette.getIndex(id);
        }
      }
    }
    return { blocks, paletteIds };
  },
};

// ---- Main-thread mesher (with features) -------------------------------------

const mesher = new GreedyMesher(registry as unknown as BlockRegistryLike);
const airSampler = (): BlockId => AIR;

// Feature generator for trees, ore, etc.
const features = new TerrainFeatures(1337, registry);

// Custom generator wrapper: base terrain + features.
class GameGenerator extends TerrainGenerator {
  private readonly features: TerrainFeatures;
  constructor(seed: number, reg: typeof registry, feat: TerrainFeatures) {
    super(seed, reg);
    this.features = feat;
  }
  override generate(chunk: VoxelChunkLike): void {
    super.generate(chunk);
    this.features.applyFeatures(chunk as unknown as Parameters<TerrainFeatures['applyFeatures']>[0]);
  }
}

const mainThreadPool: WorkerPoolLike = {
  mesh(req) {
    return new Promise((resolve) => {
      const paletteIds32 = new Uint32Array(req.paletteIds.length);
      for (let i = 0; i < req.paletteIds.length; i++) {
        paletteIds32[i] = req.paletteIds[i]!;
      }
      const chunkLike: VoxelChunkLike = {
        coord: req.chunkCoord,
        getBlock(lx, ly, lz) {
          if (lx < 0 || lx >= CHUNK_SIZE || ly < 0 || ly >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE) return AIR;
          const idx = lx + lz * CHUNK_SIZE + ly * CHUNK_SIZE * CHUNK_SIZE;
          const paletteIdx = req.blocks[idx] ?? 0;
          return paletteIds32[paletteIdx] ?? AIR;
        },
      };
      const mesh = mesher.mesh(chunkLike, req.worldOrigin, airSampler);
      resolve(mesh);
    });
  },
  get busy() {
    return 0;
  },
};

// ---- GPU mesh cache ---------------------------------------------------------

interface GpuMesh {
  vertexBuffer: GPUBuffer;
  indexBuffer: GPUBuffer;
  indexFormat: GPUIndexFormat;
  opaqueCount: number;
  transparentCount: number;
}

// ---- Main -------------------------------------------------------------------

async function main(): Promise<void> {
  const canvas = document.getElementById('gpu') as HTMLCanvasElement;
  if (!canvas) throw new Error('canvas not found');

  setText('gpu-info', 'Initializing WebGPU...');

  const renderer = await Renderer.create({ canvas, sampleCount: 1 });
  const device = renderer.gpu;
  const format = renderer.format;

  device.addEventListener('uncapturederror', (e: GPUUncapturedErrorEvent) => {
    showError(`GPU error: ${e.error.message}`);
  });

  const adapterInfo = (device as unknown as { adapterInfo?: GPUAdapterInfo }).adapterInfo;
  setText('gpu-info', adapterInfo?.description || adapterInfo?.vendor || 'WebGPU ready');

  // --- Sky pipeline ---
  const sky = new SkyRenderer({
    device,
    format,
    sampleCount: renderer.samples,
    depthFormat: renderer.depthStencilFormat,
  });
  const skyKey = renderer.registerPipeline(
    SkyRenderer.shaderSource,
    SkyRenderer.vertexLayout,
    {
      colorFormat: format,
      depthFormat: renderer.depthStencilFormat,
      blend: undefined,
      topology: 'triangle-list',
      sampleCount: renderer.samples,
    },
    {
      depthStencil: {
        format: renderer.depthStencilFormat,
        depthCompare: 'always',
        depthWriteEnabled: false,
      },
    },
  );
  sky.setPipelineKey(skyKey, renderer.pipelineCache.getIfExists(skyKey)!);

  // --- World pipelines ---
  let opaqueKey: string;
  try {
    device.pushErrorScope('validation');
    opaqueKey = renderer.registerPipeline(WORLD_WGSL, VOXEL_VERTEX_LAYOUT, {
      colorFormat: format,
      depthFormat: renderer.depthStencilFormat,
      blend: undefined,
      topology: 'triangle-list',
      sampleCount: renderer.samples,
    });
    const opaqueErr = await device.popErrorScope();
    if (opaqueErr) { showError(`Opaque pipeline: ${opaqueErr.message}`); return; }
  } catch (e) {
    showError(`Opaque pipeline exception: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }

  let transparentKey: string;
  try {
    device.pushErrorScope('validation');
    transparentKey = renderer.registerPipeline(WORLD_WGSL, VOXEL_VERTEX_LAYOUT, {
      colorFormat: format,
      depthFormat: renderer.depthStencilFormat,
      blend: {
        color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
        alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      },
      topology: 'triangle-list',
      sampleCount: renderer.samples,
    }, {
      depthStencil: {
        format: renderer.depthStencilFormat,
        depthCompare: 'less',
        depthWriteEnabled: false,
      },
    });
    const transparentErr = await device.popErrorScope();
    if (transparentErr) { showError(`Transparent pipeline: ${transparentErr.message}`); return; }
  } catch (e) {
    showError(`Transparent pipeline exception: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }

  // --- Line pipeline (for selection highlight) ---
  let lineKey: string;
  try {
    lineKey = renderer.registerPipeline(LINE_WGSL, LINE_VERTEX_LAYOUT, {
      colorFormat: format,
      depthFormat: renderer.depthStencilFormat,
      blend: {
        color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
        alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      },
      topology: 'line-list',
      sampleCount: renderer.samples,
    });
  } catch (e) {
    showError(`Line pipeline: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }

  // --- Bind groups ---
  const opaquePipeline = renderer.pipelineCache.getIfExists(opaqueKey)!;
  const worldBindGroupLayout0 = opaquePipeline.getBindGroupLayout(0);
  const worldBindGroupLayout1 = opaquePipeline.getBindGroupLayout(1);

  // Color table buffer.
  const colorBuffer = device.createBuffer({
    size: COLOR_COUNT * 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(colorBuffer, 0, colorData);

  // Atmosphere uniform buffer (shared between sky and world).
  const atmosphereBuffer = device.createBuffer({
    size: ATMOSPHERE_UNIFORM_SIZE,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const atmosphereWriter = new AtmosphereUniformWriter();

  const worldBindGroup0 = device.createBindGroup({
    layout: worldBindGroupLayout0,
    entries: [
      { binding: 0, resource: { buffer: renderer.cameraUniformBuffer } },
      { binding: 1, resource: { buffer: colorBuffer } },
    ],
  });
  const worldBindGroup1 = device.createBindGroup({
    layout: worldBindGroupLayout1,
    entries: [
      { binding: 0, resource: { buffer: atmosphereBuffer } },
    ],
  });

  const worldUniforms = [
    { groupIndex: 0, bindGroup: worldBindGroup0 },
    { groupIndex: 1, bindGroup: worldBindGroup1 },
  ];

  // Line pipeline bind group (camera only).
  const linePipeline = renderer.pipelineCache.getIfExists(lineKey)!;
  const lineBindGroupLayout = linePipeline.getBindGroupLayout(0);
  const lineBindGroup = device.createBindGroup({
    layout: lineBindGroupLayout,
    entries: [
      { binding: 0, resource: { buffer: renderer.cameraUniformBuffer } },
    ],
  });

  // --- Voxel world + generation + streaming ---
  const voxelWorld = new VoxelWorld(registry);
  const SEED = 1337;
  const gameGen = new GameGenerator(SEED, registry, features);

  const world = new World({
    seed: SEED,
    registry,
    world: voxelWorld,
    pool: mainThreadPool,
    serializer: chunkSerializer,
    generator: gameGen,
    viewDistance: 8,
    maxPerFrame: 4,
    unloadMargin: 2,
  });

  setText('workers', 'main-thread');

  // --- Physics ---
  const collider = new VoxelCollider(voxelWorld, registry);
  const body = new RigidBody({
    position: { x: 8, y: 50, z: 8 },
    halfExtents: { x: 0.3, y: 0.9, z: 0.3 },
    gravity: -28,
    friction: 0.85,
    maxSpeed: 50,
  });
  const player = new PlayerController({
    body,
    eyeHeight: 1.6,
    walkSpeed: 4.5,
    sprintSpeed: 7,
    jumpVelocity: 8.4,
    flySpeed: 16,
  });
  player.mode = 'walk';

  // --- Camera ---
  const camera = new Camera({
    mat: { mat4, mat4Perspective, mat4LookAt, mat4Multiply },
    fov: (75 * Math.PI) / 180,
    aspect: canvas.clientWidth / canvas.clientHeight,
    near: 0.1,
    far: 2000,
    position: { x: 8, y: 51.6, z: 8 },
    yaw: 0,
    pitch: -0.3,
  });

  // --- Input ---
  const input = new InputManager(canvas);
  canvas.addEventListener('click', () => {
    if (!input.pointerLocked) input.requestPointerLock();
  });

  // --- Block interaction ---
  const raycaster = new VoxelRaycaster({ maxDistance: 6, solidChecker: registry });
  const dirtyChunks = new Set<string>();
  const editor = new BlockEditor({
    world: voxelWorld,
    onChunkDirty: (coord: ChunkCoord) => {
      dirtyChunks.add(chunkKey(coord));
    },
  });

  // --- Day/night cycle ---
  const dayNight = new DayNightCycle(8, 0.3); // start at 8am, 0.3 hours/sec

  // --- GPU mesh tracking ---
  const gpuMeshes = new Map<string, GpuMesh>();

  function uploadMesh(mesh: ChunkMeshData): void {
    if (mesh.indexCount === 0) return;
    const vertexBuffer = device.createBuffer({
      size: Math.max(mesh.vertices.byteLength, 4),
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(vertexBuffer, 0, mesh.vertices);
    const indexBuffer = device.createBuffer({
      size: Math.max(mesh.indices.byteLength, 4),
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(indexBuffer, 0, mesh.indices);
    const key = chunkKey(mesh.chunk);
    const old = gpuMeshes.get(key);
    if (old) {
      old.vertexBuffer.destroy();
      old.indexBuffer.destroy();
    }
    gpuMeshes.set(key, {
      vertexBuffer,
      indexBuffer,
      indexFormat: mesh.indexFormat,
      opaqueCount: mesh.opaqueIndexCount,
      transparentCount: mesh.transparentIndexCount,
    });
  }

  // --- Selection highlight buffers (reused) ---
  const highlightVerts = new Float32Array(24 * 3);
  const highlightIndices = new Uint16Array(24);
  for (let i = 0; i < 24; i++) highlightIndices[i] = i;

  let highlightBuffer: GPUBuffer | null = null;
  let highlightIndexBuffer: GPUBuffer | null = null;

  function updateHighlight(x: number, y: number, z: number): void {
    const box = SelectionHighlight.buildBox(x, y, z);
    if (!highlightBuffer) {
      highlightBuffer = device.createBuffer({
        size: 24 * 3 * 4,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
      highlightIndexBuffer = device.createBuffer({
        size: 24 * 2,
        usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
      });
      device.queue.writeBuffer(highlightIndexBuffer, 0, highlightIndices);
    }
    device.queue.writeBuffer(highlightBuffer, 0, box.vertices);
  }

  // --- Resize ---
  function handleResize(): void {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    renderer.resize(w, h);
    camera.setAspect(w / h);
  }
  window.addEventListener('resize', handleResize);
  handleResize();

  // --- Game state ---
  let selectedSlot = 0;
  let mouseLeftPressed = false;
  let mouseRightPressed = false;
  let currentHit: ReturnType<VoxelRaycaster['cast']> = null;

  // Hotbar UI
  const hotbarEl = document.getElementById('hotbar')!;
  function renderHotbar(): void {
    let html = '';
    for (let i = 0; i < HOTBAR.length; i++) {
      const cls = i === selectedSlot ? 'hotbar-slot selected' : 'hotbar-slot';
      const color = registry.getByName(HOTBAR[i]!)!.color;
      const bg = `rgb(${Math.floor(color[0] * 255)},${Math.floor(color[1] * 255)},${Math.floor(color[2] * 255)})`;
      html += `<div class="${cls}"><div class="hotbar-color" style="background:${bg}"></div><span>${i + 1}</span></div>`;
    }
    hotbarEl.innerHTML = html;
  }
  renderHotbar();

  // Key bindings for hotbar + mode toggle
  canvas.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.code >= 'Digit1' && e.code <= 'Digit9') {
      const idx = parseInt(e.code.slice(5)) - 1;
      if (idx < HOTBAR.length) {
        selectedSlot = idx;
        renderHotbar();
      }
    }
    if (e.code === 'KeyF') {
      player.mode = player.mode === 'walk' ? 'fly' : 'walk';
      if (player.mode === 'fly') {
        body.velocity.x = 0;
        body.velocity.y = 0;
        body.velocity.z = 0;
      }
    }
  });

  // Mouse buttons for break/place
  canvas.addEventListener('mousedown', (e: MouseEvent) => {
    if (!input.pointerLocked) return;
    if (e.button === 0) mouseLeftPressed = true;   // left = break
    if (e.button === 2) mouseRightPressed = true;   // right = place
  });
  canvas.addEventListener('contextmenu', (e: Event) => e.preventDefault());

  // --- Game loop ---
  let lastTime = performance.now();
  let frameCount = 0;
  let fpsTimer = 0;
  let totalUploaded = 0;

  function frame(): void {
    const now = performance.now();
    const dt = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;

    frameCount++;
    fpsTimer += dt;
    if (fpsTimer >= 0.5) {
      setText('fps', String(Math.round(frameCount / fpsTimer)));
      frameCount = 0;
      fpsTimer = 0;
    }

    // --- Mouse look (only when locked) ---
    if (input.pointerLocked) {
      const { dx, dy } = input.mouseDelta();
      camera.yaw -= dx * 0.0025;
      camera.pitch += dy * 0.0025;
    }

    // --- Player movement ---
    const fwd = (input.isDown('KeyW') ? 1 : 0) - (input.isDown('KeyS') ? 1 : 0);
    const right = (input.isDown('KeyD') ? 1 : 0) - (input.isDown('KeyA') ? 1 : 0);
    const jump = input.isDown('Space');
    const sprint = input.isDown('ShiftLeft');
    const crouch = input.isDown('ControlLeft');

    // Convert camera yaw to player yaw.
    // Camera: yaw=0 → forward=+X, right=+Z.
    // Player: yaw=0 → forward=-Z, right=+X.
    // Correct mapping: player.yaw = -camera.yaw - π/2
    player.yaw = -camera.yaw - Math.PI / 2;
    player.update(dt, { forward: fwd, right, jump, sprint, crouch }, collider);

    // Sync camera position to player eye.
    camera.position = player.eyePosition;

    // --- Day/night ---
    dayNight.update(dt);
    sky.update(dayNight.currentTime);

    // Write atmosphere uniforms to the shared buffer for the world shader.
    const atmData: AtmosphereUniformData = {
      sunDirection: sky.sunDirection,
      sunColor: sky.sunColor,
      ambientColor: sky.ambientColor,
      fogColor: sky.fogColor,
      fogNear: 16,
      fogFar: 120,
      time: dayNight.currentTime,
      _pad: 0,
    };
    atmosphereWriter.write(atmosphereBuffer, device.queue, atmData);

    // --- World streaming ---
    world.update(camera.position, dt);

    // Process dirty chunks (from block edits).
    if (dirtyChunks.size > 0) {
      for (const key of dirtyChunks) {
        // Parse the chunk key back to coord.
        // chunkKey format: "x,y,z"
        const parts = key.split(',');
        const coord: ChunkCoord = {
          x: parseInt(parts[0]!),
          y: parseInt(parts[1]!),
          z: parseInt(parts[2]!),
        };
        world.requestRemesh(coord);
      }
      dirtyChunks.clear();
    }

    // Upload newly-ready meshes.
    const ready = world.getReadyMeshes();
    for (const mesh of ready) {
      uploadMesh(mesh);
      totalUploaded++;
    }

    // --- Block interaction (raycast from camera) ---
    const eyePos = player.eyePosition;
    const camFwd = camera.forward;
    const dir: Vec3 = vec3Normalize({ x: camFwd.x, y: camFwd.y, z: camFwd.z });
    currentHit = raycaster.cast(eyePos, dir, voxelWorld);

    if (currentHit) {
      updateHighlight(currentHit.block.x, currentHit.block.y, currentHit.block.z);
    }

    // Break/place on edge press.
    if (mouseLeftPressed && currentHit) {
      editor.breakAt(currentHit);
      mouseLeftPressed = false;
    }
    if (mouseRightPressed && currentHit) {
      // Player AABB to avoid placing inside self.
      const pos = body.position;
      const he = body.halfExtents;
      const playerAabb = {
        min: { x: pos.x, y: pos.y, z: pos.z },
        max: { x: pos.x + he.x * 2, y: pos.y + he.y * 2, z: pos.z + he.z * 2 },
      };
      editor.placeAt(currentHit, HOTBAR_IDS[selectedSlot]!, playerAabb);
      mouseRightPressed = false;
    }

    input.endFrame();

    // --- Build draw submissions ---
    const submissions: Parameters<Renderer['render']>[1] = [];
    let totalTris = 0;

    // 1. Sky first (fills background, no depth write).
    submissions.push(sky.getSubmission(renderer.cameraUniformBuffer));

    // 2. Opaque world geometry.
    for (const [, mesh] of gpuMeshes) {
      if (mesh.opaqueCount > 0) {
        submissions.push({
          pipelineKey: opaqueKey,
          vertexBuffer: mesh.vertexBuffer,
          indexBuffer: mesh.indexBuffer,
          indexFormat: mesh.indexFormat,
          indexCount: mesh.opaqueCount,
          firstIndex: 0,
          uniforms: worldUniforms,
        });
        totalTris += mesh.opaqueCount / 3;
      }
    }

    // 3. Selection highlight (lines, depth test but no write).
    if (currentHit && highlightBuffer && highlightIndexBuffer) {
      submissions.push({
        pipelineKey: lineKey,
        vertexBuffer: highlightBuffer,
        indexBuffer: highlightIndexBuffer,
        indexFormat: 'uint16',
        indexCount: 24,
        firstIndex: 0,
        uniforms: [{ groupIndex: 0, bindGroup: lineBindGroup }],
      });
    }

    // 4. Transparent world geometry (water, glass) — last, no depth write.
    for (const [, mesh] of gpuMeshes) {
      if (mesh.transparentCount > 0) {
        submissions.push({
          pipelineKey: transparentKey,
          vertexBuffer: mesh.vertexBuffer,
          indexBuffer: mesh.indexBuffer,
          indexFormat: mesh.indexFormat,
          indexCount: mesh.transparentCount,
          firstIndex: mesh.opaqueCount,
          uniforms: worldUniforms,
        });
        totalTris += mesh.transparentCount / 3;
      }
    }

    // --- Camera uniforms ---
    const view = mat4();
    const proj = mat4();
    const viewProj = mat4();
    camera.viewMatrix(view);
    camera.projMatrix(proj);
    mat4Multiply(viewProj, proj, view);

    renderer.render(
      {
        viewProj,
        view,
        proj,
        cameraPos: camera.position,
        time: now / 1000,
      },
      submissions,
    );

    // --- Stats ---
    setText('chunks', `${world.chunkCount} chunks, ${gpuMeshes.size} meshed`);
    setText('draws', String(submissions.length));
    setText('tris', String(Math.round(totalTris)));
    setText('time', `${dayNight.currentTime.toFixed(1)}h ${dayNight.isDay ? '(day)' : '(night)'}`);
    setText('mode', player.mode);

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

main().catch((err) => {
  console.error(err);
  showError(String(err?.message || err));
});
