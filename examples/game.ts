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
import { Renderer, type VertexLayout } from '../src/renderer/index.js';
import {
  BlockRegistry,
  VoxelWorld,
  Chunk,
  BlockModelRegistry,
  LANTERN_MODEL,
  PILLAR_MODEL,
  BEAM_MODEL,
} from '../src/voxel/index.js';
import type { ChunkMeshDataEx } from '../src/meshing/types.js';
import { buildModelMesh, type ModelInstance } from '../src/meshing/index.js';
import type { VoxelChunkLike as WorldVoxelChunkLike } from '../src/world/types.js';
import { ChunkManager, type BlockDescriptorProvider, type BlockDescriptorEntry, type MeshWorkerPool } from '../src/world/ChunkManager.js';
import type { ChunkSerializer } from '../src/world/types.js';
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
import {
  setWaterId,
  WaterUniformWriter,
  WATER_UNIFORM_SIZE,
  defaultWaterUniformData,
  TextureAtlas,
  registerBuiltinTextures,
  type PixelGenerator,
  BlockTextureTable,
  PostProcessChain,
  ShadowMapRenderer,
} from '../src/shaders/index.js';
import { WorkerPool } from '../src/threading/WorkerPool.js';
import type { MeshResult } from '../src/threading/messages.js';
import { FrameBudget, Stats } from '../src/performance/index.js';
import type { DrawSubmission } from '../src/renderer/types.js';

const COLOR_COUNT = 32;

function toBuf(data: Float32Array | Uint8Array | Uint16Array): GPUAllowSharedBufferSource {
  return data as unknown as GPUAllowSharedBufferSource;
}

const BLOCK_DEFS: {
  name: string;
  solid: boolean;
  transparent: boolean;
  opaqueFaces: boolean;
  color: readonly [number, number, number];
  meshType: 'cube' | 'cross' | 'none';
}[] = [
  { name: 'stone', solid: true, transparent: false, opaqueFaces: true, color: [0.5, 0.5, 0.52], meshType: 'cube' },
  { name: 'dirt', solid: true, transparent: false, opaqueFaces: true, color: [0.45, 0.32, 0.22], meshType: 'cube' },
  { name: 'grass', solid: true, transparent: false, opaqueFaces: true, color: [0.3, 0.58, 0.25], meshType: 'cube' },
  { name: 'sand', solid: true, transparent: false, opaqueFaces: true, color: [0.76, 0.7, 0.45], meshType: 'cube' },
  { name: 'water', solid: false, transparent: true, opaqueFaces: false, color: [0.2, 0.4, 0.8], meshType: 'cube' },
  { name: 'snow', solid: true, transparent: false, opaqueFaces: true, color: [0.9, 0.9, 0.95], meshType: 'cube' },
  { name: 'log', solid: true, transparent: false, opaqueFaces: true, color: [0.4, 0.28, 0.15], meshType: 'cube' },
  { name: 'leaves', solid: true, transparent: false, opaqueFaces: false, color: [0.2, 0.45, 0.2], meshType: 'cube' },
  { name: 'coal_ore', solid: true, transparent: false, opaqueFaces: true, color: [0.3, 0.3, 0.3], meshType: 'cube' },
  { name: 'iron_ore', solid: true, transparent: false, opaqueFaces: true, color: [0.6, 0.5, 0.4], meshType: 'cube' },
  { name: 'gold_ore', solid: true, transparent: false, opaqueFaces: true, color: [0.8, 0.7, 0.2], meshType: 'cube' },
  { name: 'diamond_ore', solid: true, transparent: false, opaqueFaces: true, color: [0.3, 0.8, 0.9], meshType: 'cube' },
  { name: 'cactus', solid: true, transparent: false, opaqueFaces: false, color: [0.3, 0.5, 0.25], meshType: 'cube' },
  { name: 'planks', solid: true, transparent: false, opaqueFaces: true, color: [0.65, 0.5, 0.3], meshType: 'cube' },
  { name: 'glass', solid: true, transparent: true, opaqueFaces: false, color: [0.7, 0.8, 0.9], meshType: 'cube' },
  { name: 'brick', solid: true, transparent: false, opaqueFaces: true, color: [0.6, 0.3, 0.25], meshType: 'cube' },
  { name: 'tall_grass', solid: false, transparent: false, opaqueFaces: false, color: [0.35, 0.55, 0.2], meshType: 'cross' },
  { name: 'flower_red', solid: false, transparent: false, opaqueFaces: false, color: [0.8, 0.2, 0.2], meshType: 'cross' },
  { name: 'flower_yellow', solid: false, transparent: false, opaqueFaces: false, color: [0.9, 0.8, 0.2], meshType: 'cross' },
  // Custom-model blocks (meshType 'none' so the greedy mesher skips them;
  // geometry is emitted by buildModelMesh at chunk-upload time).
  { name: 'lantern', solid: true, transparent: false, opaqueFaces: false, color: [0.85, 0.7, 0.4], meshType: 'none' },
  { name: 'pillar', solid: true, transparent: false, opaqueFaces: false, color: [0.4, 0.28, 0.15], meshType: 'none' },
  { name: 'beam', solid: true, transparent: false, opaqueFaces: false, color: [0.55, 0.4, 0.22], meshType: 'none' },
];

const HOTBAR = [
  'stone', 'dirt', 'grass', 'sand', 'log',
  'leaves', 'planks', 'glass', 'brick', 'lantern',
];

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

const LINE_VERTEX_LAYOUT: VertexLayout = {
  stride: 12,
  stepMode: 'vertex',
  attributes: [
    { name: 'position', shaderLocation: 0, format: 'float32x3', offset: 0 },
  ],
};

interface GpuMesh {
  vertexBuffer: GPUBuffer;
  indexBuffer: GPUBuffer;
  indexFormat: GPUIndexFormat;
  opaqueCount: number;
  transparentCount: number;
  crossVertexBuffer: GPUBuffer | null;
  crossIndexBuffer: GPUBuffer | null;
  crossIndexFormat: GPUIndexFormat;
  crossCount: number;
  modelVertexBuffer: GPUBuffer | null;
  modelIndexBuffer: GPUBuffer | null;
  modelIndexFormat: GPUIndexFormat;
  modelCount: number;
}

class WorkerPoolAdapter implements MeshWorkerPool {
  private readonly pool: WorkerPool;

  constructor(pool: WorkerPool) {
    this.pool = pool;
  }

  get busy(): number {
    return this.pool.busy;
  }

  mesh(req: {
    readonly chunkCoord: ChunkCoord;
    readonly worldOrigin: Vec3;
    readonly blocks: Uint8Array;
    readonly paletteIds: Uint8Array;
    readonly neighborShells?: Uint32Array | undefined;
    readonly blockFlags?: Uint8Array | undefined;
    readonly blockMeshType?: Uint8Array | undefined;
  }): Promise<ChunkMeshData> {
    const paletteIds32 = new Uint32Array(req.paletteIds.length);
    for (let i = 0; i < req.paletteIds.length; i++) {
      paletteIds32[i] = req.paletteIds[i]!;
    }
    const poolReq: Record<string, unknown> = {
      type: 'mesh',
      chunkCoord: req.chunkCoord,
      worldOrigin: req.worldOrigin,
      blocks: req.blocks,
      paletteIds: paletteIds32,
    };
    if (req.neighborShells !== undefined) poolReq.neighborShells = req.neighborShells;
    if (req.blockFlags !== undefined) poolReq.blockFlags = req.blockFlags;
    if (req.blockMeshType !== undefined) poolReq.blockMeshType = req.blockMeshType;
    return this.pool.mesh(poolReq as Omit<Parameters<WorkerPool['mesh']>[0], never>).then(
      (result: MeshResult): ChunkMeshData => result as unknown as ChunkMeshData,
    );
  }
}

class GameGenerator extends TerrainGenerator {
  private readonly features: TerrainFeatures;

  constructor(seed: number, reg: BlockRegistry, feat: TerrainFeatures) {
    super(seed, reg);
    this.features = feat;
  }

  override generate(chunk: WorldVoxelChunkLike): void {
    super.generate(chunk);
    this.features.applyFeatures(chunk);
  }
}

export interface GameCallbacks {
  onReady: () => void;
  onError: (msg: string) => void;
}

export class Game {
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: Renderer;
  private readonly device: GPUDevice;
  private readonly registry: BlockRegistry;
  private readonly hotbarIds: BlockId[];
  private readonly waterId: BlockId;
  private readonly colorData: Float32Array;

  private readonly sky: SkyRenderer;
  private readonly skyKey: string;

  private readonly opaqueKey: string;
  private readonly crossKey: string;
  private readonly transparentKey: string;
  private readonly lineKey: string;

  private readonly atmosphereBuffer: GPUBuffer;
  private readonly waterBuffer: GPUBuffer;
  private readonly atmosphereWriter: AtmosphereUniformWriter;
  private readonly waterWriter: WaterUniformWriter;
  private readonly colorBuffer: GPUBuffer;

  private readonly worldBindGroup0: GPUBindGroup;
  private readonly worldBindGroup1: GPUBindGroup;
  private readonly transparentBindGroup1: GPUBindGroup;
  private readonly lineBindGroup: GPUBindGroup;
  private readonly materialBindGroup2: GPUBindGroup;
  private readonly transparentMaterialBindGroup2: GPUBindGroup;
  private readonly shadowBindGroup3: GPUBindGroup;
  private readonly modelRegistry: BlockModelRegistry;
  private readonly postProcess: PostProcessChain;
  private readonly shadowMap: ShadowMapRenderer;

  private readonly voxelWorld: VoxelWorld;
  private readonly chunkManager: ChunkManager;
  private readonly collider: VoxelCollider;
  private readonly body: RigidBody;
  private readonly player: PlayerController;
  private readonly camera: Camera;
  private readonly input: InputManager;
  private readonly raycaster: VoxelRaycaster;
  private readonly editor: BlockEditor;
  private readonly dayNight: DayNightCycle;

  private readonly gpuMeshes = new Map<string, GpuMesh>();
  private readonly dirtyChunks = new Set<string>();
  private readonly uploadedChunks = new Set<string>();
  private readonly frameBudget: FrameBudget;
  private readonly perfStats: Stats;

  private readonly highlightIndices = new Uint16Array(24);
  private highlightBuffer: GPUBuffer | null = null;
  private highlightIndexBuffer: GPUBuffer | null = null;

  private selectedSlot = 0;
  private mouseLeftPressed = false;
  private mouseRightPressed = false;
  private currentHit: ReturnType<VoxelRaycaster['cast']> = null;
  private initialChunksReady = false;
  private callbacks: GameCallbacks;

  constructor(
    canvas: HTMLCanvasElement,
    renderer: Renderer,
    callbacks: GameCallbacks,
  ) {
    this.canvas = canvas;
    this.renderer = renderer;
    this.device = renderer.gpu;
    this.callbacks = callbacks;
    const format = renderer.format;

    this.registry = new BlockRegistry();
    for (const def of BLOCK_DEFS) {
      this.registry.register(def);
    }
    this.hotbarIds = HOTBAR.map((n) => this.registry.getByName(n)!.id);
    this.waterId = this.registry.getByName('water')!.id;
    setWaterId(this.waterId);

    this.colorData = new Float32Array(COLOR_COUNT * 4);
    for (const def of BLOCK_DEFS) {
      const bt = this.registry.getByName(def.name);
      if (bt) {
        const c = bt.color;
        this.colorData[bt.id * 4] = c[0];
        this.colorData[bt.id * 4 + 1] = c[1];
        this.colorData[bt.id * 4 + 2] = c[2];
        this.colorData[bt.id * 4 + 3] = 1;
      }
    }

    this.sky = new SkyRenderer({
      device: this.device,
      format,
      sampleCount: renderer.samples,
      depthFormat: renderer.depthStencilFormat,
    });
    this.skyKey = renderer.registerPipeline(
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
    this.sky.setPipelineKey(this.skyKey, renderer.pipelineCache.getIfExists(this.skyKey)!);

    const worldWgsl = this.buildWorldShader();
    const transparentWgsl = this.buildTransparentShader();
    const lineWgsl = this.buildLineShader();

    this.opaqueKey = renderer.registerPipeline(worldWgsl, VOXEL_VERTEX_LAYOUT, {
      colorFormat: format,
      depthFormat: renderer.depthStencilFormat,
      blend: undefined,
      topology: 'triangle-list',
      sampleCount: renderer.samples,
    });

    this.crossKey = renderer.registerPipeline(worldWgsl, VOXEL_VERTEX_LAYOUT, {
      colorFormat: format,
      depthFormat: renderer.depthStencilFormat,
      blend: undefined,
      topology: 'triangle-list',
      sampleCount: renderer.samples,
    }, {
      primitive: { cullMode: 'none' },
    });

    this.transparentKey = renderer.registerPipeline(transparentWgsl, VOXEL_VERTEX_LAYOUT, {
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

    this.lineKey = renderer.registerPipeline(lineWgsl, LINE_VERTEX_LAYOUT, {
      colorFormat: format,
      depthFormat: renderer.depthStencilFormat,
      blend: {
        color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
        alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      },
      topology: 'line-list',
      sampleCount: renderer.samples,
    });

    const opaquePipeline = renderer.pipelineCache.getIfExists(this.opaqueKey)!;
    const transparentPipeline = renderer.pipelineCache.getIfExists(this.transparentKey)!;
    const linePipeline = renderer.pipelineCache.getIfExists(this.lineKey)!;

    this.colorBuffer = this.device.createBuffer({
      size: COLOR_COUNT * 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.colorBuffer, 0, toBuf(this.colorData));

    this.atmosphereBuffer = this.device.createBuffer({
      size: ATMOSPHERE_UNIFORM_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.atmosphereWriter = new AtmosphereUniformWriter();

    this.waterBuffer = this.device.createBuffer({
      size: WATER_UNIFORM_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.waterWriter = new WaterUniformWriter();

    const worldBgl0 = opaquePipeline.getBindGroupLayout(0);
    const worldBgl1 = opaquePipeline.getBindGroupLayout(1);
    const transparentBgl1 = transparentPipeline.getBindGroupLayout(1);
    const lineBgl = linePipeline.getBindGroupLayout(0);

    this.worldBindGroup0 = this.device.createBindGroup({
      layout: worldBgl0,
      entries: [
        { binding: 0, resource: { buffer: renderer.cameraUniformBuffer } },
        { binding: 1, resource: { buffer: this.colorBuffer } },
      ],
    });
    this.worldBindGroup1 = this.device.createBindGroup({
      layout: worldBgl1,
      entries: [
        { binding: 0, resource: { buffer: this.atmosphereBuffer } },
      ],
    });
    this.transparentBindGroup1 = this.device.createBindGroup({
      layout: transparentBgl1,
      entries: [
        { binding: 0, resource: { buffer: this.atmosphereBuffer } },
        { binding: 2, resource: { buffer: this.waterBuffer } },
      ],
    });
    this.lineBindGroup = this.device.createBindGroup({
      layout: lineBgl,
      entries: [
        { binding: 0, resource: { buffer: renderer.cameraUniformBuffer } },
      ],
    });

    // ---- Phase 1: textures, post-process, shadows, models ----------------

    // Procedural texture atlas + per-block face mapping.
    const atlas = new TextureAtlas(this.device, 16, 16, 16);
    registerBuiltinTextures(atlas);
    // Extra sanctuary-oriented procedural textures.
    const planksGen: PixelGenerator = (x, y) => {
      const plank = Math.floor(y / 4);
      const seam = (y % 4 === 0) ? -18 : 0;
      const grain = Math.sin(x * 0.8 + plank * 1.7) * 10;
      const n = (Math.sin(x * 2.3) * 0.5 + 0.5) * 12 - 6;
      return [150 + grain + n + seam, 110 + grain * 0.7 + n + seam, 70 + n + seam, 255];
    };
    const paperGen: PixelGenerator = (x, y) => {
      const n = (Math.sin(x * 0.5) * Math.cos(y * 0.5)) * 6;
      return [238 + n, 234 + n, 218 + n, 255];
    };
    const mossGen: PixelGenerator = (x, y) => {
      const n = (Math.sin(x * 1.3) * Math.cos(y * 1.1)) * 18;
      return [46 + n, 78 + n * 0.8, 38 + n * 0.6, 255];
    };
    const tileGen: PixelGenerator = (x, y) => {
      const gx = x % 8 === 0 ? -22 : 0;
      const gy = y % 8 === 0 ? -22 : 0;
      const n = (Math.sin(x * 0.7) * Math.cos(y * 0.7)) * 10;
      return [70 + n + gx + gy, 70 + n + gx + gy, 78 + n + gx + gy, 255];
    };
    const brickGen: PixelGenerator = (x, y) => {
      const row = Math.floor(y / 4);
      const offset = (row % 2) * 4;
      const onSeam = (x + offset) % 8 === 0 || y % 4 === 0;
      const base = onSeam ? 90 : 150;
      const n = (Math.sin(x * 1.5) * Math.cos(y * 1.2)) * 10;
      return [base + n, base * 0.5 + n, base * 0.42 + n, 255];
    };
    const lanternGen: PixelGenerator = (x, y) => {
      const n = (Math.sin(x * 1.1) * Math.cos(y * 1.0)) * 14;
      return [120 + n, 100 + n * 0.8, 70 + n * 0.6, 255];
    };
    atlas.register('planks', planksGen);
    atlas.register('paper', paperGen);
    atlas.register('moss', mossGen);
    atlas.register('tile', tileGen);
    atlas.register('brick', brickGen);
    atlas.register('lantern', lanternGen);
    const atlasTexture = atlas.upload();
    const atlasSampler = atlas.createSampler();

    const texTable = new BlockTextureTable(COLOR_COUNT);
    const resolve = atlas.getUV.bind(atlas);
    const setTex = (name: string, faces: { top?: string; bottom?: string; side?: string }) => {
      const bt = this.registry.getByName(name);
      if (bt) texTable.setFromNames(bt.id, faces, resolve);
    };
    setTex('stone', { side: 'stone' });
    setTex('dirt', { side: 'dirt' });
    setTex('grass', { top: 'grass_top', side: 'grass_side', bottom: 'dirt' });
    setTex('sand', { side: 'sand' });
    setTex('water', { side: 'water' });
    setTex('snow', { side: 'snow' });
    setTex('log', { top: 'log_top', side: 'log_side', bottom: 'log_top' });
    setTex('leaves', { side: 'leaves' });
    setTex('planks', { side: 'planks' });
    setTex('brick', { side: 'brick' });
    setTex('tall_grass', { side: 'leaves' });
    setTex('lantern', { side: 'lantern' });
    setTex('pillar', { side: 'log_side' });
    setTex('beam', { side: 'planks' });

    const blockTextureBuffer = this.device.createBuffer({
      size: texTable.byteSize,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      label: 'tdjs-block-textures',
    });
    this.device.queue.writeBuffer(blockTextureBuffer, 0, toBuf(texTable.uniformData));

    const materialBgl2 = opaquePipeline.getBindGroupLayout(2);
    this.materialBindGroup2 = this.device.createBindGroup({
      layout: materialBgl2,
      entries: [
        { binding: 0, resource: atlasTexture.createView() },
        { binding: 1, resource: atlasSampler },
        { binding: 2, resource: { buffer: blockTextureBuffer } },
      ],
    });
    const transparentMaterialBgl2 = transparentPipeline.getBindGroupLayout(2);
    this.transparentMaterialBindGroup2 = this.device.createBindGroup({
      layout: transparentMaterialBgl2,
      entries: [
        { binding: 0, resource: atlasTexture.createView() },
        { binding: 1, resource: atlasSampler },
        { binding: 2, resource: { buffer: blockTextureBuffer } },
      ],
    });

    // Shadow map renderer + the world shader's shadow bind group (group 3).
    this.shadowMap = new ShadowMapRenderer(this.device, VOXEL_VERTEX_LAYOUT, {
      size: 2048,
      extent: 80,
      near: 1,
      far: 300,
    });
    const shadowBgl3 = opaquePipeline.getBindGroupLayout(3);
    this.shadowBindGroup3 = this.device.createBindGroup({
      layout: shadowBgl3,
      entries: [
        { binding: 0, resource: this.shadowMap.shadowMapView },
        { binding: 1, resource: this.shadowMap.shadowSampler },
        { binding: 2, resource: { buffer: this.shadowMap.shadowVPBuffer } },
      ],
    });

    // Custom block-model registry (lantern / pillar / beam).
    this.modelRegistry = new BlockModelRegistry();
    const lanternId = this.registry.getByName('lantern')!.id;
    const pillarId = this.registry.getByName('pillar')!.id;
    const beamId = this.registry.getByName('beam')!.id;
    this.modelRegistry.set(lanternId, LANTERN_MODEL);
    this.modelRegistry.set(pillarId, PILLAR_MODEL);
    this.modelRegistry.set(beamId, BEAM_MODEL);

    // Post-process chain (HDR target + bloom + ACES tonemap).
    this.postProcess = new PostProcessChain(this.device, {
      format,
      bloomThreshold: 0.7,
      bloomStrength: 0.6,
      exposure: 1.1,
      bloomDownscale: 2,
    });

    for (let i = 0; i < 24; i++) this.highlightIndices[i] = i;

    const SEED = 1337;
    this.voxelWorld = new VoxelWorld(this.registry);
    const features = new TerrainFeatures(SEED, this.registry);
    const gameGen = new GameGenerator(SEED, this.registry, features);

    const descriptorProvider: BlockDescriptorProvider = (id: BlockId): BlockDescriptorEntry | undefined => {
      const bt = this.registry.get(id);
      if (bt === undefined) return undefined;
      return {
        solid: bt.solid,
        transparent: bt.transparent,
        opaqueFaces: bt.opaqueFaces,
        meshType: bt.meshType,
      };
    };

    const workerUrl = new URL('./worker-bootstrap.ts', import.meta.url);
    const workerPool = new WorkerPool(workerUrl.href);
    const poolAdapter = new WorkerPoolAdapter(workerPool);

    const chunkSerializer: ChunkSerializer = {
      serialize(chunk) {
        const pal = (chunk as Chunk).palette;
        const palSize = pal.size;
        const paletteIds = new Uint8Array(palSize);
        for (let i = 0; i < palSize; i++) paletteIds[i] = pal.getId(i);
        const blocks = new Uint8Array(CHUNK_VOLUME);
        for (let ly = 0; ly < CHUNK_SIZE; ly++) {
          for (let lz = 0; lz < CHUNK_SIZE; lz++) {
            for (let lx = 0; lx < CHUNK_SIZE; lx++) {
              const id = chunk.getBlock(lx, ly, lz);
              const idx = lx + lz * CHUNK_SIZE + ly * CHUNK_SIZE * CHUNK_SIZE;
              blocks[idx] = pal.getIndex(id);
            }
          }
        }
        return { blocks, paletteIds };
      },
    };

    this.chunkManager = new ChunkManager({
      world: this.voxelWorld,
      gen: gameGen,
      pool: poolAdapter,
      serializer: chunkSerializer,
      blockDescriptorProvider: descriptorProvider,
      viewDistance: 8,
      maxPerFrame: 4,
      unloadMargin: 2,
    });

    this.collider = new VoxelCollider(this.voxelWorld, this.registry);
    this.body = new RigidBody({
      position: { x: 8, y: 50, z: 8 },
      halfExtents: { x: 0.3, y: 0.9, z: 0.3 },
      gravity: -28,
      friction: 0.85,
      maxSpeed: 50,
    });
    this.player = new PlayerController({
      body: this.body,
      eyeHeight: 1.6,
      walkSpeed: 4.5,
      sprintSpeed: 7,
      jumpVelocity: 8.4,
      flySpeed: 16,
      acceleration: 50,
      airControl: 0.3,
    });
    this.player.mode = 'walk';

    this.camera = new Camera({
      mat: { mat4, mat4Perspective, mat4LookAt, mat4Multiply },
      fov: (75 * Math.PI) / 180,
      aspect: canvas.clientWidth / canvas.clientHeight,
      near: 0.1,
      far: 2000,
      position: { x: 8, y: 51.6, z: 8 },
      yaw: 0,
      pitch: -0.3,
    });

    this.input = new InputManager(canvas);

    this.raycaster = new VoxelRaycaster({ maxDistance: 6, solidChecker: this.registry });
    this.editor = new BlockEditor({
      world: this.voxelWorld,
      onChunkDirty: (coord: ChunkCoord) => {
        this.dirtyChunks.add(chunkKey(coord));
      },
    });

    this.dayNight = new DayNightCycle(8, 0.3, 120);

    this.frameBudget = new FrameBudget({
      targetFps: 60,
      minViewDistance: 4,
      maxViewDistance: 12,
      minMaxPerFrame: 1,
      maxMaxPerFrame: 6,
    });
    this.perfStats = new Stats(60);

    this.setupInputHandlers();
  }

  get hotbar(): readonly string[] {
    return HOTBAR;
  }

  get registryRef(): BlockRegistry {
    return this.registry;
  }

  get selectedBlockId(): BlockId {
    return this.hotbarIds[this.selectedSlot]!;
  }

  get selectedSlotIndex(): number {
    return this.selectedSlot;
  }

  get inputManager(): InputManager {
    return this.input;
  }

  get playerMode(): string {
    return this.player.mode;
  }

  selectSlot(idx: number): void {
    if (idx >= 0 && idx < HOTBAR.length) {
      this.selectedSlot = idx;
    }
  }

  private setupInputHandlers(): void {
    this.canvas.addEventListener('click', () => {
      if (!this.input.pointerLocked) this.input.requestPointerLock();
    });

    this.canvas.addEventListener('mousedown', (e: MouseEvent) => {
      if (!this.input.pointerLocked) return;
      if (e.button === 0) this.mouseLeftPressed = true;
      if (e.button === 2) this.mouseRightPressed = true;
    });

    this.canvas.addEventListener('contextmenu', (e: Event) => e.preventDefault());
  }

  ensureSpawnChunk(): void {
    const spawnCoord: ChunkCoord = { x: 0, y: 2, z: 0 };
    this.chunkManager.ensureReady(spawnCoord, { x: 8, y: 40, z: 8 });
  }

  resize(): void {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.renderer.resize(w, h);
    this.camera.setAspect(w / h);
    this.postProcess.resize(w, h);
  }

  private uploadMesh(mesh: ChunkMeshData): void {
    const ex = mesh as ChunkMeshDataEx;
    const key = chunkKey(mesh.chunk);
    const old = this.gpuMeshes.get(key);
    if (old) {
      old.vertexBuffer.destroy();
      old.indexBuffer.destroy();
      if (old.crossVertexBuffer) old.crossVertexBuffer.destroy();
      if (old.crossIndexBuffer) old.crossIndexBuffer.destroy();
      if (old.modelVertexBuffer) old.modelVertexBuffer.destroy();
      if (old.modelIndexBuffer) old.modelIndexBuffer.destroy();
    }

    const vertexBuffer = mesh.indexCount > 0
      ? this.device.createBuffer({
          size: Math.max(mesh.vertices.byteLength, 4),
          usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        })
      : null;
    if (vertexBuffer) this.device.queue.writeBuffer(vertexBuffer, 0, toBuf(mesh.vertices));

    const indexBuffer = mesh.indexCount > 0
      ? this.device.createBuffer({
          size: Math.max(mesh.indices.byteLength, 4),
          usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
        })
      : null;
    if (indexBuffer) this.device.queue.writeBuffer(indexBuffer, 0, toBuf(mesh.indices));

    const hasCross = ex.crossIndexCount !== undefined && ex.crossIndexCount! > 0;
    const crossVertexBuffer = hasCross && ex.crossVertices
      ? this.device.createBuffer({
          size: Math.max(ex.crossVertices!.byteLength, 4),
          usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        })
      : null;
    if (crossVertexBuffer && ex.crossVertices) {
      this.device.queue.writeBuffer(crossVertexBuffer, 0, toBuf(ex.crossVertices));
    }

    const crossIndexBuffer = hasCross && ex.crossIndices
      ? this.device.createBuffer({
          size: Math.max(ex.crossIndices!.byteLength, 4),
          usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
        })
      : null;
    if (crossIndexBuffer && ex.crossIndices) {
      this.device.queue.writeBuffer(crossIndexBuffer, 0, toBuf(ex.crossIndices));
    }

    // Custom-model blocks: scan the chunk for blocks with a registered model
    // and emit their geometry into a per-chunk model buffer (rendered with the
    // opaque world pipeline, no face cull — phase 1 shallow approach).
    let modelVertexBuffer: GPUBuffer | null = null;
    let modelIndexBuffer: GPUBuffer | null = null;
    let modelIndexFormat: GPUIndexFormat = 'uint16';
    let modelCount = 0;
    const chunk = this.voxelWorld.storage.get(mesh.chunk);
    if (chunk) {
      const originX = mesh.chunk.x * CHUNK_SIZE;
      const originY = mesh.chunk.y * CHUNK_SIZE;
      const originZ = mesh.chunk.z * CHUNK_SIZE;
      const instances: ModelInstance[] = [];
      for (let ly = 0; ly < CHUNK_SIZE; ly++) {
        for (let lz = 0; lz < CHUNK_SIZE; lz++) {
          for (let lx = 0; lx < CHUNK_SIZE; lx++) {
            const id = chunk.getBlock(lx, ly, lz);
            if (id === AIR) continue;
            const model = this.modelRegistry.get(id);
            if (model === undefined) continue;
            instances.push({
              blockId: id,
              model,
              x: originX + lx,
              y: originY + ly,
              z: originZ + lz,
            });
          }
        }
      }
      if (instances.length > 0) {
        const modelMesh = buildModelMesh(instances);
        modelIndexFormat = modelMesh.indexFormat;
        modelCount = modelMesh.indexCount;
        modelVertexBuffer = this.device.createBuffer({
          size: Math.max(modelMesh.vertices.byteLength, 4),
          usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });
        this.device.queue.writeBuffer(modelVertexBuffer, 0, toBuf(modelMesh.vertices));
        modelIndexBuffer = this.device.createBuffer({
          size: Math.max(modelMesh.indices.byteLength, 4),
          usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
        });
        this.device.queue.writeBuffer(modelIndexBuffer, 0, toBuf(modelMesh.indices));
      }
    }

    this.gpuMeshes.set(key, {
      vertexBuffer: vertexBuffer!,
      indexBuffer: indexBuffer!,
      indexFormat: mesh.indexFormat,
      opaqueCount: mesh.opaqueIndexCount,
      transparentCount: mesh.transparentIndexCount,
      crossVertexBuffer: crossVertexBuffer,
      crossIndexBuffer: crossIndexBuffer,
      crossIndexFormat: ex.crossIndexFormat ?? 'uint16',
      crossCount: ex.crossIndexCount ?? 0,
      modelVertexBuffer,
      modelIndexBuffer,
      modelIndexFormat,
      modelCount,
    });
  }

  private updateHighlight(x: number, y: number, z: number): void {
    const box = SelectionHighlight.buildBox(x, y, z);
    if (!this.highlightBuffer) {
      this.highlightBuffer = this.device.createBuffer({
        size: 24 * 3 * 4,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
      this.highlightIndexBuffer = this.device.createBuffer({
        size: 24 * 2,
        usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
      });
      this.device.queue.writeBuffer(this.highlightIndexBuffer, 0, toBuf(this.highlightIndices));
    }
    this.device.queue.writeBuffer(this.highlightBuffer, 0, toBuf(box.vertices));
  }

  private buildWorldShader(): string {
    return /* wgsl */ `
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
  colors : array<vec4<f32>, ${COLOR_COUNT}>,
};

struct BlockTextureTable {
  rects : array<vec4<f32>, ${COLOR_COUNT * 3}>,
};

@group(0) @binding(0) var<uniform> camera : CameraUniform;
@group(0) @binding(1) var<uniform> colorTable : ColorTable;
@group(1) @binding(0) var<uniform> atmosphere : AtmosphereUniform;

@group(2) @binding(0) var atlasTex : texture_2d<f32>;
@group(2) @binding(1) var atlasSamp : sampler;
@group(2) @binding(2) var<uniform> blockTextures : BlockTextureTable;

@group(3) @binding(0) var shadowMap : texture_depth_2d;
@group(3) @binding(1) var shadowSamp : sampler_comparison;
@group(3) @binding(2) var<uniform> shadowVP : mat4x4<f32>;

const SHADOW_SIZE = 2048.0;
const HDR_SCALE = 1.3;

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
  @location(3) uv       : vec2<f32>,
};

@vertex
fn vs_main(in : VertexInput) -> VertexOutput {
  var out : VertexOutput;
  out.clipPos = camera.viewProj * vec4<f32>(in.position, 1.0);
  out.normal = in.normal;
  out.worldPos = in.position;
  out.packed = in.packed;
  out.uv = in.uv;
  return out;
}

fn applyFog(color: vec3<f32>, worldPos: vec3<f32>) -> vec3<f32> {
  let dist = distance(worldPos, camera.cameraPos.xyz);
  let range = max(atmosphere.fogFar - atmosphere.fogNear, 0.001);
  let distFactor = 1.0 - exp(-max(dist - atmosphere.fogNear, 0.0) / range);
  let heightDensity = exp(-max(worldPos.y, 0.0) * 0.02);
  let heightFactor = (1.0 - exp(-dist * 0.01)) * heightDensity;
  let factor = clamp(max(distFactor, heightFactor * 0.5), 0.0, 1.0);
  return mix(color, atmosphere.fogColor.xyz, factor);
}

fn faceIndexFromNormal(n: vec3<f32>) -> u32 {
  if (n.y > 0.5) { return 0u; }
  if (n.y < -0.5) { return 1u; }
  return 2u;
}

fn sampleBlockColor(blockId: u32, n: vec3<f32>, uv: vec2<f32>) -> vec3<f32> {
  let face = faceIndexFromNormal(n);
  let rect = blockTextures.rects[blockId * 3u + face];
  if (rect.x == 0.0 && rect.y == 0.0 && rect.z == 0.0 && rect.w == 0.0) {
    return colorTable.colors[blockId].rgb;
  }
  let fu = fract(uv.x);
  let fv = fract(uv.y);
  let atlasUv = vec2<f32>(mix(rect.x, rect.z, fu), mix(rect.y, rect.w, fv));
  return textureSample(atlasTex, atlasSamp, atlasUv).rgb;
}

fn shadowFactor(worldPos: vec3<f32>, n: vec3<f32>) -> f32 {
  let clip = shadowVP * vec4<f32>(worldPos, 1.0);
  let ndc = clip.xyz / clip.w;
  let uv = ndc.xy * 0.5 + 0.5;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 || ndc.z > 1.0 || ndc.z < 0.0) {
    return 1.0;
  }
  let sunDir = normalize(atmosphere.sunDirection.xyz);
  let bias = 0.0015 + 0.004 * (1.0 - max(dot(n, sunDir), 0.0));
  let ref = ndc.z - bias;
  let texel = 1.0 / SHADOW_SIZE;
  var sum = 0.0;
  sum += textureSampleCompareLevel(shadowMap, shadowSamp, uv, ref);
  sum += textureSampleCompareLevel(shadowMap, shadowSamp, uv + vec2<f32>( texel, 0.0), ref);
  sum += textureSampleCompareLevel(shadowMap, shadowSamp, uv + vec2<f32>(-texel, 0.0), ref);
  sum += textureSampleCompareLevel(shadowMap, shadowSamp, uv + vec2<f32>(0.0,  texel), ref);
  sum += textureSampleCompareLevel(shadowMap, shadowSamp, uv + vec2<f32>(0.0, -texel), ref);
  return sum / 5.0;
}

@fragment
fn fs_main(in : VertexOutput) -> @location(0) vec4<f32> {
  let blockId = (in.packed >> 16u) & 0xFFFFu;
  let ao = f32(in.packed & 0xFFu) / 3.0;
  let aoFactor = 0.4 + 0.6 * ao;

  if (blockId >= ${COLOR_COUNT}u) {
    return vec4<f32>(1.0, 0.0, 1.0, 1.0);
  }

  let n = normalize(in.normal);
  let baseColor = sampleBlockColor(blockId, n, in.uv);
  let sunDir = normalize(atmosphere.sunDirection.xyz);
  let ndotl = max(dot(n, sunDir), 0.0);
  let shadow = shadowFactor(in.worldPos, n);
  let sunLight = atmosphere.sunColor.xyz * ndotl * shadow;
  let ambient = atmosphere.ambientColor.xyz;
  let lighting = ambient + sunLight;
  var color = baseColor * lighting * aoFactor;

  color = applyFog(color, in.worldPos);
  return vec4<f32>(color * HDR_SCALE, 1.0);
}
`;
  }

  private buildTransparentShader(): string {
    return /* wgsl */ `
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
  colors : array<vec4<f32>, ${COLOR_COUNT}>,
};

struct BlockTextureTable {
  rects : array<vec4<f32>, ${COLOR_COUNT * 3}>,
};

struct WaterUniform {
  waterColor    : vec4<f32>,
  waterDepth    : f32,
  waveAmplitude : f32,
  time          : f32,
  _pad          : f32,
};

@group(0) @binding(0) var<uniform> camera : CameraUniform;
@group(0) @binding(1) var<uniform> colorTable : ColorTable;
@group(1) @binding(0) var<uniform> atmosphere : AtmosphereUniform;
@group(1) @binding(2) var<uniform> water : WaterUniform;

@group(2) @binding(0) var atlasTex : texture_2d<f32>;
@group(2) @binding(1) var atlasSamp : sampler;
@group(2) @binding(2) var<uniform> blockTextures : BlockTextureTable;

const WATER_ID_U32 = ${this.waterId}u;
const HDR_SCALE = 1.3;

struct VertexInput {
  @location(0) position : vec3<f32>,
  @location(1) normal   : vec3<f32>,
  @location(2) packed   : u32,
  @location(3) uv       : vec2<f32>,
};

struct WaterVertexOutput {
  @builtin(position) clipPos : vec4<f32>,
  @location(0) normal   : vec3<f32>,
  @location(1) worldPos : vec3<f32>,
  @location(2) @interpolate(flat) packed : u32,
  @location(3) uv       : vec2<f32>,
};

@vertex
fn vs_main(in : VertexInput) -> WaterVertexOutput {
  var out : WaterVertexOutput;
  var pos = in.position;
  let blockId = (in.packed >> 16u) & 0xFFFFu;
  if (blockId == WATER_ID_U32) {
    let t = water.time;
    let wave = sin(pos.x * 2.0 + t * 1.5) * cos(pos.z * 2.0 + t * 1.3) * water.waveAmplitude;
    pos.y = pos.y + wave;
  }
  out.worldPos = pos;
  out.clipPos = camera.viewProj * vec4<f32>(pos, 1.0);
  out.normal = in.normal;
  out.packed = in.packed;
  out.uv = in.uv;
  return out;
}

fn applyFog(color: vec3<f32>, worldPos: vec3<f32>) -> vec3<f32> {
  let dist = distance(worldPos, camera.cameraPos.xyz);
  let range = max(atmosphere.fogFar - atmosphere.fogNear, 0.001);
  let distFactor = 1.0 - exp(-max(dist - atmosphere.fogNear, 0.0) / range);
  let heightDensity = exp(-max(worldPos.y, 0.0) * 0.02);
  let heightFactor = (1.0 - exp(-dist * 0.01)) * heightDensity;
  let factor = clamp(max(distFactor, heightFactor * 0.5), 0.0, 1.0);
  return mix(color, atmosphere.fogColor.xyz, factor);
}

fn faceIndexFromNormal(n: vec3<f32>) -> u32 {
  if (n.y > 0.5) { return 0u; }
  if (n.y < -0.5) { return 1u; }
  return 2u;
}

fn sampleBlockColor(blockId: u32, n: vec3<f32>, uv: vec2<f32>) -> vec3<f32> {
  let face = faceIndexFromNormal(n);
  let rect = blockTextures.rects[blockId * 3u + face];
  if (rect.x == 0.0 && rect.y == 0.0 && rect.z == 0.0 && rect.w == 0.0) {
    return colorTable.colors[blockId].rgb;
  }
  let fu = fract(uv.x);
  let fv = fract(uv.y);
  let atlasUv = vec2<f32>(mix(rect.x, rect.z, fu), mix(rect.y, rect.w, fv));
  return textureSample(atlasTex, atlasSamp, atlasUv).rgb;
}

@fragment
fn fs_main(in : WaterVertexOutput) -> @location(0) vec4<f32> {
  let blockId = (in.packed >> 16u) & 0xFFFFu;
  let ao = f32(in.packed & 0xFFu) / 3.0;
  let aoFactor = 0.4 + 0.6 * ao;

  if (blockId >= ${COLOR_COUNT}u) {
    return vec4<f32>(1.0, 0.0, 1.0, 0.5);
  }

  let n = normalize(in.normal);
  let baseColor = sampleBlockColor(blockId, n, in.uv);
  let sunDir = normalize(atmosphere.sunDirection.xyz);
  let ndotl = max(dot(n, sunDir), 0.0);
  let sunLight = atmosphere.sunColor.xyz * ndotl;
  let ambient = atmosphere.ambientColor.xyz;
  let lighting = ambient + sunLight;
  var color = baseColor * lighting * aoFactor;

  color = applyFog(color, in.worldPos);

  if (blockId == WATER_ID_U32) {
    let t = water.time;
    let scrollUv = in.uv + vec2<f32>(t * 0.05, t * 0.03);
    let shimmer = (sin(scrollUv.x * 8.0) * cos(scrollUv.y * 8.0)) * 0.5 + 0.5;
    let viewDir = normalize(camera.cameraPos.xyz - in.worldPos);
    let fresnel = pow(1.0 - max(dot(n, viewDir), 0.0), 3.0);
    let waterCol = water.waterColor.xyz;
    let depthFade = clamp(water.waterDepth, 0.0, 1.0);
    let tinted = mix(color, waterCol, 0.5 * depthFade);
    color = tinted + shimmer * 0.15 + fresnel * 0.5;
    let alpha = mix(0.6, 0.9, fresnel);
    return vec4<f32>(color * HDR_SCALE, alpha);
  }

  return vec4<f32>(color * HDR_SCALE, 0.6);
}
`;
  }

  private buildLineShader(): string {
    return /* wgsl */ `
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
  }

  update(dt: number, now: number): {
    fps: number;
    pos: string;
    time: string;
    chunks: string;
    draws: number;
    tris: number;
    mode: string;
    loaded: boolean;
  } {
    this.frameBudget.recordFrame(dt);

    if (this.input.pointerLocked) {
      const { dx, dy } = this.input.mouseDelta();
      this.camera.yaw -= dx * 0.0025;
      this.camera.pitch += dy * 0.0025;
    }

    const fwd = (this.input.isDown('KeyW') ? 1 : 0) - (this.input.isDown('KeyS') ? 1 : 0);
    const right = (this.input.isDown('KeyD') ? 1 : 0) - (this.input.isDown('KeyA') ? 1 : 0);
    const jump = this.input.isDown('Space');
    const sprint = this.input.isDown('ShiftLeft');
    const crouch = this.input.isDown('ControlLeft');

    this.player.yaw = -this.camera.yaw - Math.PI / 2;
    this.player.update(dt, { forward: fwd, right, jump, sprint, crouch }, this.collider);
    this.camera.position = this.player.eyePosition;

    for (let i = 0; i < HOTBAR.length; i++) {
      if (this.input.wasPressed(`Digit${i + 1}`)) {
        this.selectedSlot = i;
      }
    }
    if (this.input.wasPressed('KeyF')) {
      this.player.mode = this.player.mode === 'walk' ? 'fly' : 'walk';
      if (this.player.mode === 'fly') {
        this.body.velocity.x = 0;
        this.body.velocity.y = 0;
        this.body.velocity.z = 0;
      }
    }

    this.dayNight.advance(dt);
    this.sky.update(this.dayNight.currentTime);

    const atmData: AtmosphereUniformData = {
      sunDirection: this.dayNight.sunDirection,
      sunColor: this.sky.sunColor,
      ambientColor: this.sky.ambientColor,
      fogColor: this.sky.fogColor,
      fogNear: 16,
      fogFar: 120,
      time: this.dayNight.currentTime,
      _pad: 0,
    };
    this.atmosphereWriter.write(this.atmosphereBuffer, this.device.queue, atmData);

    const waterData = defaultWaterUniformData(now / 1000);
    this.waterWriter.write(this.waterBuffer, this.device.queue, waterData);

    this.chunkManager.update(this.camera.position, dt);

    if (this.dirtyChunks.size > 0) {
      for (const key of this.dirtyChunks) {
        const parts = key.split(',');
        const coord: ChunkCoord = {
          x: parseInt(parts[0]!),
          y: parseInt(parts[1]!),
          z: parseInt(parts[2]!),
        };
        this.chunkManager.requestRemesh(coord);
        this.uploadedChunks.delete(key);
      }
      this.dirtyChunks.clear();
    }

    const ready = this.chunkManager.getReadyMeshes();
    for (const mesh of ready) {
      const key = chunkKey(mesh.chunk);
      if (!this.uploadedChunks.has(key)) {
        this.uploadMesh(mesh);
        this.uploadedChunks.add(key);
      }
    }

    if (!this.initialChunksReady && this.gpuMeshes.size >= 4) {
      this.initialChunksReady = true;
      this.callbacks.onReady();
    }

    const eyePos = this.player.eyePosition;
    const camFwd = this.camera.forward;
    const dir: Vec3 = vec3Normalize({ x: camFwd.x, y: camFwd.y, z: camFwd.z });
    this.currentHit = this.raycaster.cast(eyePos, dir, this.voxelWorld);

    if (this.currentHit) {
      this.updateHighlight(this.currentHit.block.x, this.currentHit.block.y, this.currentHit.block.z);
    }

    if (this.mouseLeftPressed && this.currentHit) {
      this.editor.breakAt(this.currentHit);
      this.mouseLeftPressed = false;
    }
    if (this.mouseRightPressed && this.currentHit) {
      const pos = this.body.position;
      const he = this.body.halfExtents;
      const playerAabb = {
        min: { x: pos.x, y: pos.y, z: pos.z },
        max: { x: pos.x + he.x * 2, y: pos.y + he.y * 2, z: pos.z + he.z * 2 },
      };
      this.editor.placeAt(this.currentHit, this.hotbarIds[this.selectedSlot]!, playerAabb);
      this.mouseRightPressed = false;
    }

    this.input.endFrame();

    // World-space uniforms shared by the opaque + cross + model passes:
    // group 0 = camera + color table, group 1 = atmosphere,
    // group 2 = material atlas, group 3 = shadow map.
    const worldUniforms = [
      { groupIndex: 0, bindGroup: this.worldBindGroup0 },
      { groupIndex: 1, bindGroup: this.worldBindGroup1 },
      { groupIndex: 2, bindGroup: this.materialBindGroup2 },
      { groupIndex: 3, bindGroup: this.shadowBindGroup3 },
    ];
    const transparentUniforms = [
      { groupIndex: 0, bindGroup: this.worldBindGroup0 },
      { groupIndex: 1, bindGroup: this.transparentBindGroup1 },
      { groupIndex: 2, bindGroup: this.transparentMaterialBindGroup2 },
    ];

    // Collect world geometry submissions (opaque + model + cross) for both the
    // shadow pass and the main pass.
    const opaqueSubmissions: DrawSubmission[] = [];
    const modelSubmissions: DrawSubmission[] = [];
    const crossSubmissions: DrawSubmission[] = [];
    let totalTris = 0;

    for (const [, mesh] of this.gpuMeshes) {
      if (mesh.opaqueCount > 0) {
        opaqueSubmissions.push({
          pipelineKey: this.opaqueKey,
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

    for (const [, mesh] of this.gpuMeshes) {
      if (mesh.modelCount > 0 && mesh.modelVertexBuffer && mesh.modelIndexBuffer) {
        modelSubmissions.push({
          pipelineKey: this.crossKey,
          vertexBuffer: mesh.modelVertexBuffer,
          indexBuffer: mesh.modelIndexBuffer,
          indexFormat: mesh.modelIndexFormat,
          indexCount: mesh.modelCount,
          firstIndex: 0,
          uniforms: worldUniforms,
        });
        totalTris += mesh.modelCount / 3;
      }
    }

    for (const [, mesh] of this.gpuMeshes) {
      if (mesh.crossCount > 0 && mesh.crossVertexBuffer && mesh.crossIndexBuffer) {
        crossSubmissions.push({
          pipelineKey: this.crossKey,
          vertexBuffer: mesh.crossVertexBuffer,
          indexBuffer: mesh.crossIndexBuffer,
          indexFormat: mesh.crossIndexFormat,
          indexCount: mesh.crossCount,
          firstIndex: 0,
          uniforms: worldUniforms,
        });
        totalTris += mesh.crossCount / 3;
      }
    }

    // ---- Shadow pass: render world geometry into the sun shadow map. -----
    const focus = this.player.eyePosition;
    this.shadowMap.computeMatrix(this.dayNight.sunDirection, focus);
    const shadowSubmissions = opaqueSubmissions.concat(modelSubmissions);
    this.shadowMap.render(shadowSubmissions);

    // ---- Main pass: sky + opaque + model + cross + lines + transparent,
    //      rendered into the HDR scene target. -----------------------------
    const submissions: DrawSubmission[] = [];
    submissions.push(this.sky.getSubmission(this.renderer.cameraUniformBuffer));
    for (const s of opaqueSubmissions) submissions.push(s);
    for (const s of modelSubmissions) submissions.push(s);
    for (const s of crossSubmissions) submissions.push(s);

    if (this.currentHit && this.highlightBuffer && this.highlightIndexBuffer) {
      submissions.push({
        pipelineKey: this.lineKey,
        vertexBuffer: this.highlightBuffer,
        indexBuffer: this.highlightIndexBuffer,
        indexFormat: 'uint16',
        indexCount: 24,
        firstIndex: 0,
        uniforms: [{ groupIndex: 0, bindGroup: this.lineBindGroup }],
      });
    }

    for (const [, mesh] of this.gpuMeshes) {
      if (mesh.transparentCount > 0) {
        submissions.push({
          pipelineKey: this.transparentKey,
          vertexBuffer: mesh.vertexBuffer,
          indexBuffer: mesh.indexBuffer,
          indexFormat: mesh.indexFormat,
          indexCount: mesh.transparentCount,
          firstIndex: mesh.opaqueCount,
          uniforms: transparentUniforms,
        });
        totalTris += mesh.transparentCount / 3;
      }
    }

    const view = mat4();
    const proj = mat4();
    const viewProj = mat4();
    this.camera.viewMatrix(view);
    this.camera.projMatrix(proj);
    mat4Multiply(viewProj, proj, view);

    this.renderer.renderToColorView(
      this.postProcess.sceneColorView,
      {
        viewProj,
        view,
        proj,
        cameraPos: this.camera.position,
        time: now / 1000,
      },
      submissions,
    );

    // ---- Post-process: bloom + ACES tone map → swapchain. ---------------
    this.postProcess.render(this.renderer.currentSwapchainView);

    this.perfStats.record({
      fps: Math.round(1 / dt),
      frameTime: dt * 1000,
      chunkCount: this.chunkManager.chunkCount,
      meshedChunks: this.gpuMeshes.size,
      drawCalls: submissions.length,
      triangles: Math.round(totalTris),
      gpuTimeEstimate: 0,
      memoryEstimate: 0,
    });

    const p = this.body.position;
    const hours = Math.floor(this.dayNight.currentTime);
    const mins = Math.floor((this.dayNight.currentTime - hours) * 60);
    const timeStr = `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')} ${this.dayNight.isDay ? '☀' : '☾'}`;

    return {
      fps: this.frameBudget.isThrottled
        ? Math.round(this.frameBudget.avgFps)
        : Math.round(1 / dt),
      pos: `${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}`,
      time: timeStr,
      chunks: `${this.chunkManager.chunkCount} chunks, ${this.gpuMeshes.size} meshed`,
      draws: submissions.length,
      tris: Math.round(totalTris),
      mode: this.player.mode,
      loaded: this.initialChunksReady,
    };
  }

  dispose(): void {
    for (const [, mesh] of this.gpuMeshes) {
      mesh.vertexBuffer.destroy();
      mesh.indexBuffer.destroy();
      if (mesh.crossVertexBuffer) mesh.crossVertexBuffer.destroy();
      if (mesh.crossIndexBuffer) mesh.crossIndexBuffer.destroy();
      if (mesh.modelVertexBuffer) mesh.modelVertexBuffer.destroy();
      if (mesh.modelIndexBuffer) mesh.modelIndexBuffer.destroy();
    }
    this.gpuMeshes.clear();
    if (this.highlightBuffer) this.highlightBuffer.destroy();
    if (this.highlightIndexBuffer) this.highlightIndexBuffer.destroy();
    this.postProcess.dispose();
    this.shadowMap.dispose();
  }
}
