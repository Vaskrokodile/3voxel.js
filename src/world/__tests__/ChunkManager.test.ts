import { describe, it, expect } from 'vitest';
import type { BlockId, ChunkCoord, Vec3 } from '../../core/types.js';
import { AIR, CHUNK_SIZE } from '../../core/types.js';
import { ChunkManager, ChunkState } from '../ChunkManager.js';
import type {
  BlockRegistryLike,
  BlockTypeLike,
  ChunkMeshDataLike,
  ChunkSerializer,
  VoxelChunkLike,
  VoxelWorldLike,
  WorkerPoolLike,
} from '../types.js';
import { TerrainGenerator } from '../../generation/TerrainGenerator.js';

class FakeChunk implements VoxelChunkLike {
  readonly coord: ChunkCoord;
  readonly blocks: Uint8Array;
  constructor(coord: ChunkCoord) {
    this.coord = coord;
    this.blocks = new Uint8Array(CHUNK_SIZE ** 3);
  }
  private idx(lx: number, ly: number, lz: number): number {
    return (ly * CHUNK_SIZE + lz) * CHUNK_SIZE + lx;
  }
  getBlock(lx: number, ly: number, lz: number): BlockId {
    return this.blocks[this.idx(lx, ly, lz)] ?? AIR;
  }
  setBlock(lx: number, ly: number, lz: number, id: BlockId): void {
    this.blocks[this.idx(lx, ly, lz)] = id;
  }
}

class FakeWorld implements VoxelWorldLike {
  readonly chunks = new Map<string, FakeChunk>();
  private key(c: ChunkCoord): string {
    return `${c.x},${c.y},${c.z}`;
  }
  ensureChunk(coord: ChunkCoord): VoxelChunkLike {
    const k = this.key(coord);
    let c = this.chunks.get(k);
    if (!c) {
      c = new FakeChunk(coord);
      this.chunks.set(k, c);
    }
    return c;
  }
  getBlock(wx: number, wy: number, wz: number): BlockId {
    return AIR;
  }
  setBlock(_wx: number, _wy: number, _wz: number, _id: BlockId): void {
    /* noop */
  }
  unloadChunk(coord: ChunkCoord): void {
    this.chunks.delete(this.key(coord));
  }
}

function makeRegistry(): BlockRegistryLike {
  const byName = new Map<string, BlockTypeLike>();
  const byId = new Map<number, BlockTypeLike>();
  const defs: Array<[string, boolean, boolean]> = [
    ['stone', true, false],
    ['dirt', true, false],
    ['grass', true, false],
    ['sand', true, false],
    ['water', false, true],
    ['snow', true, false],
  ];
  defs.forEach(([name, solid, transparent], i) => {
    const bt: BlockTypeLike = { id: i + 1, name, solid, transparent };
    byName.set(name, bt);
    byId.set(bt.id, bt);
  });
  return {
    get(id: BlockId): BlockTypeLike {
      const v = byId.get(id);
      if (!v) throw new Error(`unknown id ${id}`);
      return v;
    },
    getByName(name: string): BlockTypeLike | undefined {
      return byName.get(name);
    },
  };
}

/** Fake serializer: emits a 1-entry palette (AIR) and the raw block bytes. */
class FakeSerializer implements ChunkSerializer {
  serialize(chunk: VoxelChunkLike): { blocks: Uint8Array; paletteIds: Uint8Array } {
    // Re-read the chunk's blocks via getBlock into a fresh Uint8Array.
    const blocks = new Uint8Array(CHUNK_SIZE ** 3);
    let i = 0;
    for (let ly = 0; ly < CHUNK_SIZE; ly++) {
      for (let lz = 0; lz < CHUNK_SIZE; lz++) {
        for (let lx = 0; lx < CHUNK_SIZE; lx++) {
          blocks[i++] = chunk.getBlock(lx, ly, lz) & 0xff;
        }
      }
    }
    return { blocks, paletteIds: new Uint8Array([0, 1, 2, 3, 4, 5, 6]) };
  }
}

/** Fake pool: returns a canned mesh after a microtask. */
class FakePool implements WorkerPoolLike {
  busy = 0;
  private readonly canned: ChunkMeshDataLike = {
    chunk: { x: 0, y: 0, z: 0 },
    vertices: new Uint8Array(0),
    indices: new Uint8Array(0),
    indexFormat: 'uint16',
    vertexCount: 0,
    indexCount: 0,
    opaqueIndexCount: 0,
    transparentIndexCount: 0,
  };
  async mesh(req: {
    chunkCoord: ChunkCoord;
  }): Promise<ChunkMeshDataLike> {
    this.busy++;
    await Promise.resolve();
    this.busy--;
    return { ...this.canned, chunk: req.chunkCoord };
  }
}

/**
 * Capturing pool: records the full mesh request (including neighbor shells
 * and block descriptors) so tests can assert the manager built them.
 */
class CapturingPool implements WorkerPoolLike {
  busy = 0;
  lastReq: {
    chunkCoord: ChunkCoord;
    worldOrigin: Vec3;
    blocks: Uint8Array;
    paletteIds: Uint8Array;
    neighborShells?: Uint32Array;
    blockFlags?: Uint8Array;
    blockMeshType?: Uint8Array;
  } | null = null;

  async mesh(req: {
    chunkCoord: ChunkCoord;
    worldOrigin: Vec3;
    blocks: Uint8Array;
    paletteIds: Uint8Array;
    neighborShells?: Uint32Array;
    blockFlags?: Uint8Array;
    blockMeshType?: Uint8Array;
  }): Promise<ChunkMeshDataLike> {
    this.lastReq = req;
    this.busy++;
    await Promise.resolve();
    this.busy--;
    return {
      chunk: req.chunkCoord,
      vertices: new Uint8Array(0),
      indices: new Uint8Array(0),
      indexFormat: 'uint16',
      vertexCount: 0,
      indexCount: 0,
      opaqueIndexCount: 0,
      transparentIndexCount: 0,
    };
  }
}

function makeManager(): {
  manager: ChunkManager;
  world: FakeWorld;
  pool: FakePool;
  gen: TerrainGenerator;
} {
  const world = new FakeWorld();
  const gen = new TerrainGenerator(1, makeRegistry());
  const pool = new FakePool();
  const serializer = new FakeSerializer();
  const manager = new ChunkManager({
    world,
    gen,
    pool,
    serializer,
    viewDistance: 2,
    maxPerFrame: 4,
    unloadMargin: 1,
  });
  return { manager, world, pool, gen };
}

describe('ChunkManager', () => {
  it('transitions a chunk Empty -> Ready and yields a ready mesh', async () => {
    const { manager } = makeManager();
    const cameraPos: Vec3 = { x: 0, y: 32, z: 0 };
    // First update starts generation + submits mesh.
    manager.update(cameraPos, 0.016);
    // Mesh promise resolves on a microtask; flush it.
    await Promise.resolve();
    await Promise.resolve();
    // Second update resolves the mesh into Ready.
    manager.update(cameraPos, 0.016);
    const meshes = manager.getReadyMeshes();
    expect(meshes.length).toBeGreaterThan(0);
    // The camera chunk (0,2,0) should be Ready.
    expect(manager.stateOf({ x: 0, y: 2, z: 0 })).toBe(ChunkState.Ready);
  });

  it('unloads chunks beyond the margin (deletes state + world chunk)', async () => {
    const { manager, world } = makeManager();
    const cam0: Vec3 = { x: 0, y: 32, z: 0 };
    manager.update(cam0, 0.016);
    await Promise.resolve();
    await Promise.resolve();
    manager.update(cam0, 0.016);
    expect(world.chunks.size).toBeGreaterThan(0);
    // Move camera far away so all previously-loaded chunks are out of range.
    const camFar: Vec3 = { x: 1000, y: 32, z: 1000 };
    manager.update(camFar, 0.016);
    // All chunks near origin should be unloaded.
    expect(manager.stateOf({ x: 0, y: 2, z: 0 })).toBeUndefined();
    expect(world.chunks.has('0,2,0')).toBe(false);
  });

  it('ensureReady immediately starts a chunk', async () => {
    const { manager } = makeManager();
    manager.ensureReady({ x: 0, y: 2, z: 0 }, { x: 0, y: 32, z: 0 });
    await Promise.resolve();
    await Promise.resolve();
    manager.update({ x: 0, y: 32, z: 0 }, 0.016);
    expect(manager.stateOf({ x: 0, y: 2, z: 0 })).toBe(ChunkState.Ready);
  });

  it('extracts neighbor border shells and block descriptors into the mesh request', async () => {
    // World that reports a STONE block in the -x neighbor of chunk (0,2,0):
    // chunk world origin is (0, 32, 0); -x neighbor cell at world (-1, 32, 0).
    class NeighborWorld extends FakeWorld {
      override getBlock(wx: number, _wy: number, _wz: number): BlockId {
        if (wx === -1) return 1; // STONE in the -x neighbor shell
        return AIR;
      }
    }
    const world = new NeighborWorld();
    const gen = new TerrainGenerator(1, makeRegistry());
    const pool = new CapturingPool();
    const serializer = new FakeSerializer();
    const manager = new ChunkManager({
      world,
      gen,
      pool,
      serializer,
      viewDistance: 2,
      maxPerFrame: 4,
      unloadMargin: 1,
      blockDescriptorProvider: (id: BlockId) => {
        if (id === AIR) return { solid: false, transparent: false, opaqueFaces: false, meshType: 'none' };
        if (id === 1) return { solid: true, transparent: false, opaqueFaces: true, meshType: 'cube' };
        return { solid: true, transparent: false, opaqueFaces: true, meshType: 'cube' };
      },
    });

    manager.ensureReady({ x: 0, y: 2, z: 0 }, { x: 0, y: 32, z: 0 });
    await Promise.resolve();
    await Promise.resolve();

    expect(pool.lastReq).not.toBeNull();
    const req = pool.lastReq!;
    // Neighbor shells packed: length 6 * 16 * 16, -x face at dir 0.
    expect(req.neighborShells).toBeDefined();
    expect(req.neighborShells!.length).toBe(6 * 16 * 16);
    // -x neighbor shell at (ly=0, lz=0) => index 0; world.getBlock(-1,32,0) = 1.
    expect(req.neighborShells![0]).toBe(1);
    // A cell in the -x shell that maps to a non-(-1) world x is AIR.
    // (ly=0, lz=0) -> world (-1, 32, 0) = STONE; all -x cells have wx=-1 => STONE.
    // +x shell (dir 1) cells map to wx=16 => AIR.
    expect(req.neighborShells![1 * 16 * 16]).toBe(AIR);

    // Block descriptors built from the palette ([0,1,2,3,4,5,6]).
    expect(req.blockFlags).toBeDefined();
    expect(req.blockMeshType).toBeDefined();
    expect(req.blockFlags!.length).toBe(7);
    // id=1 (STONE): solid | opaqueFaces = 1 | 4 = 5.
    expect(req.blockFlags![1]).toBe(5);
    expect(req.blockMeshType![1]).toBe(1);
  });

  it('omits block descriptors when no provider is configured', async () => {
    const world = new FakeWorld();
    const gen = new TerrainGenerator(1, makeRegistry());
    const pool = new CapturingPool();
    const serializer = new FakeSerializer();
    const manager = new ChunkManager({
      world,
      gen,
      pool,
      serializer,
      viewDistance: 2,
      maxPerFrame: 4,
      unloadMargin: 1,
    });

    manager.ensureReady({ x: 0, y: 2, z: 0 }, { x: 0, y: 32, z: 0 });
    await Promise.resolve();
    await Promise.resolve();

    expect(pool.lastReq).not.toBeNull();
    // Neighbor shells are always sent; descriptors are not (no provider).
    expect(pool.lastReq!.neighborShells).toBeDefined();
    expect(pool.lastReq!.blockFlags).toBeUndefined();
    expect(pool.lastReq!.blockMeshType).toBeUndefined();
  });
});
