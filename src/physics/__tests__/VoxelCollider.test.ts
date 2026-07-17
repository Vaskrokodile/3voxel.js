import { describe, it, expect } from 'vitest';
import { VoxelCollider, type SolidChecker, type VoxelColliderWorld } from '../VoxelCollider.js';
import type { AABB, BlockId } from '../../core/types.js';

/** Concrete fake world: solid blocks recorded as a set of integer cells. */
class FakeWorld implements VoxelColliderWorld {
  private readonly solids = new Set<string>();
  setSolid(x: number, y: number, z: number): void {
    this.solids.add(`${x},${y},${z}`);
  }
  getBlock(x: number, y: number, z: number): BlockId {
    return this.solids.has(`${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`) ? 1 : 0;
  }
}

/** Concrete fake solidity lookup: any non-AIR id is solid. */
class FakeSolidChecker implements SolidChecker {
  get(id: BlockId): { solid: boolean } {
    return { solid: id !== 0 };
  }
}

function makeCollider(): { collider: VoxelCollider; world: FakeWorld } {
  const world = new FakeWorld();
  const collider = new VoxelCollider(world, new FakeSolidChecker());
  return { collider, world };
}

function aabbFrom(min: [number, number, number], max: [number, number, number]): AABB {
  return {
    min: { x: min[0], y: min[1], z: min[2] },
    max: { x: max[0], y: max[1], z: max[2] },
  };
}

describe('VoxelCollider.intersectsSolid', () => {
  it('returns false for an AABB above the floor', () => {
    const { collider, world } = makeCollider();
    world.setSolid(0, 0, 0); // floor cell
    const box = aabbFrom([-0.3, 1.1, -0.3], [0.3, 1.9, 0.3]);
    expect(collider.intersectsSolid(box)).toBe(false);
  });

  it('returns true for an AABB touching the floor', () => {
    const { collider, world } = makeCollider();
    world.setSolid(0, 0, 0);
    const box = aabbFrom([-0.3, 0.0, -0.3], [0.3, 0.8, 0.3]);
    expect(collider.intersectsSolid(box)).toBe(true);
  });

  it('returns true for an AABB inside the floor', () => {
    const { collider, world } = makeCollider();
    world.setSolid(0, 0, 0);
    const box = aabbFrom([-0.3, -0.5, -0.3], [0.3, 0.3, 0.3]);
    expect(collider.intersectsSolid(box)).toBe(true);
  });

  it('returns false when no solid voxels exist', () => {
    const { collider } = makeCollider();
    const box = aabbFrom([0, 0, 0], [1, 1, 1]);
    expect(collider.intersectsSolid(box)).toBe(false);
  });

  it('detects a solid voxel at negative coordinates', () => {
    const { collider, world } = makeCollider();
    world.setSolid(-1, -1, -1);
    const box = aabbFrom([-1.5, -1.5, -1.5], [-0.5, -0.5, -0.5]);
    expect(collider.intersectsSolid(box)).toBe(true);
  });
});

describe('VoxelCollider.sweep', () => {
  it('returns null when the path is clear', () => {
    const { collider } = makeCollider();
    const box = aabbFrom([0.2, 1.5, 0.2], [0.8, 2.5, 0.8]);
    expect(collider.sweep(box, { x: 0, y: -5, z: 0 })).toBeNull();
  });

  it('detects a downward sweep hitting the floor with +Y normal', () => {
    const { collider, world } = makeCollider();
    world.setSolid(0, 0, 0); // floor
    const box = aabbFrom([0.2, 1.5, 0.2], [0.8, 2.5, 0.8]);
    const result = collider.sweep(box, { x: 0, y: -5, z: 0 });
    expect(result).not.toBeNull();
    expect(result!.collided).toBe(true);
    expect(result!.normal).toEqual({ x: 0, y: 1, z: 0 });
    expect(result!.depth).toBeGreaterThan(0);
  });

  it('detects a sideways sweep hitting a wall with -X normal', () => {
    const { collider, world } = makeCollider();
    // Wall at x=2 (cell [2,3)).
    world.setSolid(2, 0, 0);
    const box = aabbFrom([0.2, 0.2, 0.2], [0.8, 0.8, 0.8]);
    const result = collider.sweep(box, { x: 5, y: 0, z: 0 });
    expect(result).not.toBeNull();
    expect(result!.collided).toBe(true);
    expect(result!.normal).toEqual({ x: -1, y: 0, z: 0 });
  });

  it('returns null for zero velocity when not overlapping', () => {
    const { collider, world } = makeCollider();
    world.setSolid(0, 0, 0);
    const box = aabbFrom([0.2, 2.0, 0.2], [0.8, 2.8, 0.8]);
    expect(collider.sweep(box, { x: 0, y: 0, z: 0 })).toBeNull();
  });

  it('reports a collision for zero velocity when already overlapping', () => {
    const { collider, world } = makeCollider();
    world.setSolid(0, 0, 0);
    const box = aabbFrom([-0.3, 0.2, -0.3], [0.3, 1.0, 0.3]);
    const result = collider.sweep(box, { x: 0, y: 0, z: 0 });
    expect(result).not.toBeNull();
    expect(result!.collided).toBe(true);
  });
});
