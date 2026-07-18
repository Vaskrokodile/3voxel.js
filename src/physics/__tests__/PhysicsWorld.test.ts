import { describe, it, expect } from 'vitest';
import { VoxelCollider, type SolidChecker, type VoxelColliderWorld } from '../VoxelCollider.js';
import { RigidBody } from '../RigidBody.js';
import { PhysicsWorld } from '../PhysicsWorld.js';
import type { BlockId } from '../../core/types.js';

class FakeWorld implements VoxelColliderWorld {
  private readonly solids = new Set<string>();
  setSolid(x: number, y: number, z: number): void {
    this.solids.add(`${x},${y},${z}`);
  }
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

function makeWorld(): { world: PhysicsWorld; collider: VoxelCollider; fake: FakeWorld } {
  const fake = new FakeWorld();
  fake.fillFloor(-4, 4, -4, 4);
  const collider = new VoxelCollider(fake, new FakeSolidChecker());
  return { world: new PhysicsWorld(collider), collider, fake };
}

describe('PhysicsWorld', () => {
  it('starts empty', () => {
    const { world } = makeWorld();
    expect(world.bodyCount).toBe(0);
  });

  it('addBody registers a body and removeBody removes it', () => {
    const { world } = makeWorld();
    const body = new RigidBody({
      position: { x: 0, y: 5, z: 0 },
      halfExtents: { x: 0.3, y: 0.9, z: 0.3 },
    });
    world.addBody(body);
    expect(world.bodyCount).toBe(1);
    expect(world.removeBody(body)).toBe(true);
    expect(world.bodyCount).toBe(0);
    expect(world.removeBody(body)).toBe(false);
  });

  it('addBody does not register duplicates', () => {
    const { world } = makeWorld();
    const body = new RigidBody({
      position: { x: 0, y: 5, z: 0 },
      halfExtents: { x: 0.3, y: 0.9, z: 0.3 },
    });
    world.addBody(body);
    world.addBody(body);
    expect(world.bodyCount).toBe(1);
  });

  it('clear removes every body', () => {
    const { world } = makeWorld();
    world.addBody(new RigidBody({ position: { x: 0, y: 5, z: 0 }, halfExtents: { x: 0.3, y: 0.9, z: 0.3 } }));
    world.addBody(new RigidBody({ position: { x: 1, y: 5, z: 0 }, halfExtents: { x: 0.3, y: 0.9, z: 0.3 } }));
    world.clear();
    expect(world.bodyCount).toBe(0);
  });

  it('step integrates gravity and lands every body on the floor', () => {
    const { world } = makeWorld();
    const a = world.addBody(new RigidBody({ position: { x: 0, y: 5, z: 0 }, halfExtents: { x: 0.3, y: 0.9, z: 0.3 } }));
    const b = world.addBody(new RigidBody({ position: { x: 2, y: 8, z: 1 }, halfExtents: { x: 0.3, y: 0.9, z: 0.3 } }));
    for (let i = 0; i < 300; i++) world.step(DT);
    expect(a.onGround).toBe(true);
    expect(b.onGround).toBe(true);
    expect(a.position.y).toBeGreaterThanOrEqual(0.99);
    expect(b.position.y).toBeGreaterThanOrEqual(0.99);
  });

  it('step with non-positive dt is a no-op', () => {
    const { world } = makeWorld();
    const body = world.addBody(new RigidBody({ position: { x: 0, y: 5, z: 0 }, halfExtents: { x: 0.3, y: 0.9, z: 0.3 } }));
    world.step(0);
    expect(body.position.y).toBe(5);
    expect(body.velocity.y).toBe(0);
    world.step(-1);
    expect(body.position.y).toBe(5);
  });
});
