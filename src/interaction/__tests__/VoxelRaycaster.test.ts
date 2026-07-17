import { describe, it, expect } from 'vitest';
import type { BlockId, Vec3 } from '../../core/types.js';
import {
  VoxelRaycaster,
  type SolidChecker,
  type VoxelRaycastWorld,
} from '../VoxelRaycaster.js';

/** In-memory world backed by a Map keyed by "x,y,z". */
class FakeWorld implements VoxelRaycastWorld {
  private readonly blocks = new Map<string, BlockId>();

  private key(x: number, y: number, z: number): string {
    return `${x},${y},${z}`;
  }

  set(x: number, y: number, z: number, id: BlockId): void {
    this.blocks.set(this.key(x, y, z), id);
  }

  getBlock(wx: number, wy: number, wz: number): BlockId {
    return this.blocks.get(this.key(wx, wy, wz)) ?? 0;
  }
}

/** Treats any non-AIR id as solid. */
class AllSolidChecker implements SolidChecker {
  get(id: BlockId): { solid: boolean } {
    return { solid: id !== 0 };
  }
}

/** Only a specific id is solid. */
class SingleSolidChecker implements SolidChecker {
  constructor(private readonly solidId: BlockId) {}
  get(id: BlockId): { solid: boolean } {
    return { solid: id === this.solidId };
  }
}

const normalize = (v: Vec3): Vec3 => {
  const len = Math.hypot(v.x, v.y, v.z);
  const inv = len < 1e-12 ? 0 : 1 / len;
  return { x: v.x * inv, y: v.y * inv, z: v.z * inv };
};

describe('VoxelRaycaster', () => {
  it('hits a solid block straight below the origin with top-face normal', () => {
    const world = new FakeWorld();
    world.set(5, 0, 5, 1);
    const caster = new VoxelRaycaster({
      maxDistance: 10,
      solidChecker: new AllSolidChecker(),
    });

    const hit = caster.cast({ x: 5.5, y: 5.5, z: 5.5 }, { x: 0, y: -1, z: 0 }, world);

    expect(hit).not.toBeNull();
    expect(hit!.block).toEqual({ x: 5, y: 0, z: 5 });
    expect(hit!.normal).toEqual({ x: 0, y: 1, z: 0 });
    expect(hit!.blockId).toBe(1);
    // Distance from y=5.5 down to the top face of block (5,0,5) at y=1.
    expect(hit!.distance).toBeCloseTo(4.5, 5);
  });

  it('misses when no solid block is in range along +X', () => {
    const world = new FakeWorld();
    world.set(5, 0, 5, 1);
    const caster = new VoxelRaycaster({
      maxDistance: 6,
      solidChecker: new AllSolidChecker(),
    });

    const hit = caster.cast({ x: 5.5, y: 5.5, z: 5.5 }, { x: 1, y: 0, z: 0 }, world);
    expect(hit).toBeNull();
  });

  it('stops at maxDistance cutoff', () => {
    const world = new FakeWorld();
    // Solid block 20 units below — beyond reach.
    world.set(5, -15, 5, 1);
    const caster = new VoxelRaycaster({
      maxDistance: 6,
      solidChecker: new AllSolidChecker(),
    });

    const hit = caster.cast({ x: 5.5, y: 5.5, z: 5.5 }, { x: 0, y: -1, z: 0 }, world);
    expect(hit).toBeNull();
  });

  it('hits a block within reach just inside maxDistance', () => {
    const world = new FakeWorld();
    // Top face of (5,0,5) is at y=1; origin y=5.5 => distance 4.5 < 6.
    world.set(5, 0, 5, 1);
    const caster = new VoxelRaycaster({
      maxDistance: 6,
      solidChecker: new AllSolidChecker(),
    });

    const hit = caster.cast({ x: 5.5, y: 5.5, z: 5.5 }, { x: 0, y: -1, z: 0 }, world);
    expect(hit).not.toBeNull();
    expect(hit!.block).toEqual({ x: 5, y: 0, z: 5 });
  });

  it('returns the starting voxel with zero normal when origin is inside a solid block', () => {
    const world = new FakeWorld();
    world.set(3, 3, 3, 7);
    const caster = new VoxelRaycaster({
      maxDistance: 10,
      solidChecker: new AllSolidChecker(),
    });

    const hit = caster.cast({ x: 3.5, y: 3.5, z: 3.5 }, { x: 0, y: 1, z: 0 }, world);
    expect(hit).not.toBeNull();
    expect(hit!.block).toEqual({ x: 3, y: 3, z: 3 });
    expect(hit!.normal).toEqual({ x: 0, y: 0, z: 0 });
    expect(hit!.distance).toBe(0);
    expect(hit!.blockId).toBe(7);
  });

  it('hits the correct face when approaching along +X', () => {
    const world = new FakeWorld();
    world.set(10, 0, 0, 1);
    const caster = new VoxelRaycaster({
      maxDistance: 20,
      solidChecker: new AllSolidChecker(),
    });

    const hit = caster.cast({ x: 0.5, y: 0.5, z: 0.5 }, { x: 1, y: 0, z: 0 }, world);
    expect(hit).not.toBeNull();
    expect(hit!.block).toEqual({ x: 10, y: 0, z: 0 });
    // Entered through the -X face => normal (-1,0,0).
    expect(hit!.normal).toEqual({ x: -1, y: 0, z: 0 });
  });

  it('hits the correct face when approaching along -Z', () => {
    const world = new FakeWorld();
    world.set(0, 0, -5, 1);
    const caster = new VoxelRaycaster({
      maxDistance: 20,
      solidChecker: new AllSolidChecker(),
    });

    const hit = caster.cast({ x: 0.5, y: 0.5, z: 0.5 }, { x: 0, y: 0, z: -1 }, world);
    expect(hit).not.toBeNull();
    expect(hit!.block).toEqual({ x: 0, y: 0, z: -5 });
    expect(hit!.normal).toEqual({ x: 0, y: 0, z: 1 });
  });

  it('handles a diagonal ray and hits the nearest solid block', () => {
    const world = new FakeWorld();
    world.set(3, 3, 3, 1);
    const caster = new VoxelRaycaster({
      maxDistance: 20,
      solidChecker: new AllSolidChecker(),
    });

    const dir = normalize({ x: 1, y: 1, z: 1 });
    const hit = caster.cast({ x: 0.5, y: 0.5, z: 0.5 }, dir, world);
    expect(hit).not.toBeNull();
    expect(hit!.block).toEqual({ x: 3, y: 3, z: 3 });
    expect(hit!.blockId).toBe(1);
  });

  it('ignores non-solid ids when a SolidChecker says they are not solid', () => {
    const world = new FakeWorld();
    world.set(5, 2, 5, 2); // not solid per SingleSolidChecker(1)
    world.set(5, 0, 5, 1); // solid
    const caster = new VoxelRaycaster({
      maxDistance: 20,
      solidChecker: new SingleSolidChecker(1),
    });

    const hit = caster.cast({ x: 5.5, y: 5.5, z: 5.5 }, { x: 0, y: -1, z: 0 }, world);
    expect(hit).not.toBeNull();
    expect(hit!.block).toEqual({ x: 5, y: 0, z: 5 });
    expect(hit!.blockId).toBe(1);
  });

  it('handles a ray exactly along an axis from a voxel boundary', () => {
    const world = new FakeWorld();
    world.set(0, -3, 0, 1);
    const caster = new VoxelRaycaster({
      maxDistance: 20,
      solidChecker: new AllSolidChecker(),
    });

    // Origin exactly on a voxel boundary at y=0.
    const hit = caster.cast({ x: 0.5, y: 0, z: 0.5 }, { x: 0, y: -1, z: 0 }, world);
    expect(hit).not.toBeNull();
    expect(hit!.block).toEqual({ x: 0, y: -3, z: 0 });
    expect(hit!.normal).toEqual({ x: 0, y: 1, z: 0 });
  });
});
