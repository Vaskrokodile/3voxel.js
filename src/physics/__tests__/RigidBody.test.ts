import { describe, it, expect } from 'vitest';
import { VoxelCollider, type SolidChecker, type VoxelColliderWorld } from '../VoxelCollider.js';
import { RigidBody } from '../RigidBody.js';
import type { BlockId } from '../../core/types.js';

class FakeWorld implements VoxelColliderWorld {
  private readonly solids = new Set<string>();
  setSolid(x: number, y: number, z: number): void {
    this.solids.add(`${x},${y},${z}`);
  }
  /** Fill a horizontal floor of solid cells at y=0 across [minX,maxX]x[minZ,maxZ]. */
  fillFloor(minX: number, maxX: number, minZ: number, maxZ: number): void {
    for (let x = minX; x <= maxX; x++) {
      for (let z = minZ; z <= maxZ; z++) {
        this.setSolid(x, 0, z);
      }
    }
  }
  getBlock(x: number, y: number, z: number): BlockId {
    return this.solids.has(`${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`) ? 1 : 0;
  }
}

class FakeSolidChecker implements SolidChecker {
  get(id: BlockId): { solid: boolean } {
    return { solid: id !== 0 };
  }
}

const DT = 1 / 60;

function makeBody(y: number): RigidBody {
  return new RigidBody({
    position: { x: 0, y, z: 0 },
    halfExtents: { x: 0.3, y: 0.9, z: 0.3 },
  });
}

function makeFloorCollider(): { collider: VoxelCollider; world: FakeWorld } {
  const world = new FakeWorld();
  world.fillFloor(-4, 4, -4, 4);
  const collider = new VoxelCollider(world, new FakeSolidChecker());
  return { collider, world };
}

describe('RigidBody', () => {
  it('falls and lands on the floor with onGround=true', () => {
    const { collider } = makeFloorCollider();
    const body = makeBody(5);
    // Step until it settles.
    for (let i = 0; i < 200; i++) {
      body.step(DT, collider);
    }
    expect(body.onGround).toBe(true);
    // Feet rest on top of cell y=0, i.e. y == 1.0 (within a small epsilon).
    expect(body.position.y).toBeGreaterThanOrEqual(0.99);
    expect(body.position.y).toBeLessThanOrEqual(1.05);
    expect(body.velocity.y).toBe(0);
  });

  it('a body resting on the floor stays on the floor', () => {
    const { collider } = makeFloorCollider();
    const body = makeBody(1.0);
    body.onGround = true;
    for (let i = 0; i < 30; i++) {
      body.step(DT, collider);
    }
    expect(body.onGround).toBe(true);
    expect(body.position.y).toBeGreaterThanOrEqual(0.99);
    expect(body.position.y).toBeLessThanOrEqual(1.01);
  });

  it('a jump leaves the ground', () => {
    const { collider } = makeFloorCollider();
    const body = makeBody(1.0);
    body.onGround = true;
    // First settle so onGround is confirmed by the engine.
    body.step(DT, collider);
    expect(body.onGround).toBe(true);
    // Jump.
    body.applyImpulse({ x: 0, y: 8.4, z: 0 });
    body.step(DT, collider);
    expect(body.onGround).toBe(false);
    expect(body.position.y).toBeGreaterThan(1.0);
    expect(body.velocity.y).toBeGreaterThan(0);
  });

  it('does not fall through a thin ceiling when moving up', () => {
    const { collider, world } = makeFloorCollider();
    // Ceiling at y=3 (cell [3,4)).
    world.setSolid(0, 3, 0);
    const body = makeBody(1.0);
    body.onGround = true;
    // Big upward impulse.
    body.applyImpulse({ x: 0, y: 50, z: 0 });
    // Step a few times; the body should not penetrate the ceiling.
    for (let i = 0; i < 20; i++) {
      body.step(DT, collider);
    }
    // The body's head (position.y + 1.8) must not pass through y=3.
    expect(body.position.y + 1.8).toBeLessThanOrEqual(3.0 + 0.01);
  });

  it('horizontal movement is blocked by a wall', () => {
    const { collider, world } = makeFloorCollider();
    // Wall at x=2.
    world.setSolid(2, 0, 0);
    const body = makeBody(1.0);
    body.onGround = true;
    body.setHorizontalVelocity(10, 0);
    for (let i = 0; i < 30; i++) {
      body.step(DT, collider);
    }
    // Body's max.x must not pass into cell x=2.
    expect(body.position.x + 0.6).toBeLessThanOrEqual(2.0 + 0.01);
  });

  it('applyImpulse adds to velocity', () => {
    const body = makeBody(5);
    body.applyImpulse({ x: 1, y: 2, z: 3 });
    expect(body.velocity).toEqual({ x: 1, y: 2, z: 3 });
  });

  it('setHorizontalVelocity sets only X/Z', () => {
    const body = makeBody(5);
    body.applyImpulse({ x: 1, y: 2, z: 3 });
    body.setHorizontalVelocity(5, 7);
    expect(body.velocity.x).toBe(5);
    expect(body.velocity.z).toBe(7);
    expect(body.velocity.y).toBe(2);
  });

  it('clamps velocity to maxSpeed', () => {
    const body = new RigidBody({
      position: { x: 0, y: 50, z: 0 },
      halfExtents: { x: 0.3, y: 0.9, z: 0.3 },
      maxSpeed: 10,
    });
    body.applyImpulse({ x: 100, y: 0, z: 0 });
    const { collider } = makeFloorCollider();
    body.step(DT, collider);
    const sp = Math.hypot(body.velocity.x, body.velocity.y, body.velocity.z);
    expect(sp).toBeLessThanOrEqual(10 + 1e-6);
  });
});
