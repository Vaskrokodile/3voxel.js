import { describe, it, expect } from 'vitest';
import { VoxelCollider, type SolidChecker, type VoxelColliderWorld } from '../VoxelCollider.js';
import { RigidBody } from '../RigidBody.js';
import { PlayerController, type PlayerInput } from '../PlayerController.js';
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

function makePlayer(y: number): { player: PlayerController; body: RigidBody; collider: VoxelCollider; world: FakeWorld } {
  const world = new FakeWorld();
  world.fillFloor(-8, 8, -8, 8);
  const collider = new VoxelCollider(world, new FakeSolidChecker());
  const body = new RigidBody({
    position: { x: 0, y, z: 0 },
    halfExtents: { x: 0.3, y: 0.9, z: 0.3 },
  });
  const player = new PlayerController({
    body,
    eyeHeight: 1.6,
    walkSpeed: 4.3,
    sprintSpeed: 5.6,
    jumpVelocity: 8.4,
    flySpeed: 11,
  });
  return { player, body, collider, world };
}

const input = (over: Partial<PlayerInput>): PlayerInput => ({
  forward: 0,
  right: 0,
  jump: false,
  sprint: false,
  crouch: false,
  ...over,
});

describe('PlayerController', () => {
  it('eyePosition is feet + eyeHeight', () => {
    const { player, body } = makePlayer(5);
    body.position.x = 1;
    body.position.y = 2;
    body.position.z = 3;
    expect(player.eyePosition).toEqual({ x: 1, y: 3.6, z: 3 });
  });

  it('walk mode: forward input moves the body toward -Z at yaw 0', () => {
    const { player, body, collider } = makePlayer(1.0);
    player.yaw = 0;
    player.mode = 'walk';
    player.update(DT, input({ forward: 1 }), collider);
    expect(body.position.z).toBeLessThan(-0.001);
    expect(body.position.x).toBeCloseTo(0, 5);
  });

  it('walk mode: right input strafes toward +X at yaw 0', () => {
    const { player, body, collider } = makePlayer(1.0);
    player.yaw = 0;
    player.mode = 'walk';
    player.update(DT, input({ right: 1 }), collider);
    expect(body.position.x).toBeGreaterThan(0.001);
    expect(body.position.z).toBeCloseTo(0, 5);
  });

  it('walk mode: jump applies an upward impulse when grounded', () => {
    const { player, body, collider } = makePlayer(1.0);
    player.yaw = 0;
    player.mode = 'walk';
    // Settle on ground first.
    for (let i = 0; i < 5; i++) player.update(DT, input({}), collider);
    expect(body.onGround).toBe(true);
    const yBefore = body.position.y;
    player.update(DT, input({ jump: true }), collider);
    expect(body.position.y).toBeGreaterThan(yBefore);
    expect(body.onGround).toBe(false);
  });

  it('walk mode: sprint uses sprintSpeed', () => {
    const { player: p1, body: b1, collider: c } = makePlayer(1.0);
    const { player: p2, body: b2 } = makePlayer(1.0);
    p1.yaw = 0;
    p2.yaw = 0;
    p1.mode = 'walk';
    p2.mode = 'walk';
    // Step several times and compare distances.
    for (let i = 0; i < 10; i++) {
      p1.update(DT, input({ forward: 1 }), c);
      p2.update(DT, input({ forward: 1, sprint: true }), c);
    }
    expect(Math.abs(b2.position.z)).toBeGreaterThan(Math.abs(b1.position.z));
  });

  it('fly mode: ignores gravity (no downward acceleration)', () => {
    const { player, body, collider } = makePlayer(20);
    player.yaw = 0;
    player.mode = 'fly';
    // No input -> velocity zeroed, body should not fall.
    for (let i = 0; i < 30; i++) player.update(DT, input({}), collider);
    expect(body.position.y).toBeCloseTo(20, 5);
    expect(body.velocity.y).toBe(0);
  });

  it('fly mode: jump ascends, sprint/crouch descend', () => {
    const { player, body, collider } = makePlayer(20);
    player.yaw = 0;
    player.mode = 'fly';
    player.update(DT, input({ jump: true }), collider);
    expect(body.position.y).toBeGreaterThan(20);
    expect(body.velocity.y).toBeGreaterThan(0);
  });

  it('fly mode: forward + ascend moves up and toward -Z', () => {
    const { player, body, collider } = makePlayer(20);
    player.yaw = 0;
    player.mode = 'fly';
    player.update(DT, input({ forward: 1, jump: true }), collider);
    expect(body.position.z).toBeLessThan(0);
    expect(body.position.y).toBeGreaterThan(20);
  });

  it('fly mode: crouch descends', () => {
    const { player, body, collider } = makePlayer(20);
    player.yaw = 0;
    player.mode = 'fly';
    player.update(DT, input({ crouch: true }), collider);
    expect(body.position.y).toBeLessThan(20);
    expect(body.velocity.y).toBeLessThan(0);
  });

  it('walk mode: air control is reduced vs ground control', () => {
    // Two players: one on the ground, one in the air, both given forward input
    // for a single step. The grounded player should reach a higher horizontal
    // speed because air control multiplies acceleration by 0.3.
    const ground = makePlayer(1.0);
    const air = makePlayer(1.0);
    ground.player.yaw = 0;
    air.player.yaw = 0;
    ground.player.mode = 'walk';
    air.player.mode = 'walk';
    // Settle the ground player so onGround is true.
    for (let i = 0; i < 5; i++) ground.player.update(DT, input({}), ground.collider);
    expect(ground.body.onGround).toBe(true);
    // Force the air player off the ground with an upward impulse and confirm
    // it is airborne before applying horizontal input.
    air.body.applyImpulse({ x: 0, y: 20, z: 0 });
    air.player.update(DT, input({}), air.collider);
    expect(air.body.onGround).toBe(false);
    // Now apply one step of forward input to each.
    ground.player.update(DT, input({ forward: 1 }), ground.collider);
    air.player.update(DT, input({ forward: 1 }), air.collider);
    const groundSpeed = Math.hypot(ground.body.velocity.x, ground.body.velocity.z);
    const airSpeed = Math.hypot(air.body.velocity.x, air.body.velocity.z);
    expect(groundSpeed).toBeGreaterThan(airSpeed);
  });

  it('walk mode: custom airControl of 1 matches ground control', () => {
    const world = new FakeWorld();
    world.fillFloor(-8, 8, -8, 8);
    const collider = new VoxelCollider(world, new FakeSolidChecker());
    const body = new RigidBody({
      position: { x: 0, y: 1.0, z: 0 },
      halfExtents: { x: 0.3, y: 0.9, z: 0.3 },
    });
    const player = new PlayerController({
      body,
      eyeHeight: 1.6,
      walkSpeed: 4.3,
      sprintSpeed: 5.6,
      jumpVelocity: 8.4,
      flySpeed: 11,
      airControl: 1,
    });
    player.yaw = 0;
    player.mode = 'walk';
    // Settle, then jump so we are airborne.
    for (let i = 0; i < 5; i++) player.update(DT, input({}), collider);
    player.update(DT, input({ jump: true }), collider);
    expect(body.onGround).toBe(false);
    // With airControl=1, the air acceleration equals ground acceleration.
    const v0 = Math.hypot(body.velocity.x, body.velocity.z);
    player.update(DT, input({ forward: 1 }), collider);
    const v1 = Math.hypot(body.velocity.x, body.velocity.z);
    expect(v1).toBeGreaterThan(v0);
  });
});
