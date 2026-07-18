import type { Vec3 } from '../core/types.js';
import type { RigidBody } from './RigidBody.js';
import type { VoxelCollider } from './VoxelCollider.js';

/** Locomotion mode. */
export type PlayerMode = 'walk' | 'fly';

/** Construction options for a {@link PlayerController}. */
export interface PlayerOptions {
  /** The body this controller drives. */
  body: RigidBody;
  /** Eye height above the body's feet (position), e.g. 1.6. */
  eyeHeight: number;
  /** Walk speed in blocks/s. */
  walkSpeed: number;
  /** Sprint speed in blocks/s. */
  sprintSpeed: number;
  /** Upward impulse applied on jump (blocks/s). */
  jumpVelocity: number;
  /** Fly speed in blocks/s. */
  flySpeed: number;
  /**
   * Ground acceleration in blocks/s². The horizontal velocity is eased
   * toward the input target at this rate. Default 50 (near-instant).
   */
  acceleration?: number;
  /**
   * Air-control multiplier applied to {@link PlayerOptions.acceleration}
   * when the body is airborne (0.3 = 30% of ground acceleration).
   * Default 0.3.
   */
  airControl?: number;
}

/**
 * Per-frame player input. `forward`/`right` are camera-space movement in
 * [-1, 1]; the controller rotates them by {@link PlayerController.yaw}.
 */
export interface PlayerInput {
  /** Forward (+1) / backward (-1). */
  forward: number;
  /** Strafe right (+1) / left (-1). */
  right: number;
  /** Jump (walk mode) / ascend (fly mode). */
  jump: boolean;
  /** Sprint (walk mode) / descend (fly mode). */
  sprint: boolean;
  /** Crouch / descend (fly mode). */
  crouch: boolean;
}

/**
 * First-person player controller with walk and fly modes.
 *
 * The controller reads {@link yaw} (radians, set by the game from the camera
 * each frame) and converts {@link PlayerInput} into world-space velocity on
 * the attached {@link RigidBody}.
 *
 * Walk mode: horizontal velocity from forward/right * yaw, jump impulse when
 * grounded, gravity + collision via {@link RigidBody.step}.
 * Fly mode: full 3D velocity from forward/right + ascend/descend, no gravity,
 * collision-only movement via {@link RigidBody.move}.
 */
export class PlayerController {
  /** Current locomotion mode. Switch freely between 'walk' and 'fly'. */
  mode: PlayerMode;
  /**
   * Camera yaw in radians. Set this from the camera before calling
   * {@link update}. Yaw 0 looks toward -Z; yaw increases counter-clockwise
   * viewed from above (+Y up).
   */
  yaw: number;

  private readonly body: RigidBody;
  private readonly eyeHeight: number;
  private readonly walkSpeed: number;
  private readonly sprintSpeed: number;
  private readonly jumpVelocity: number;
  private readonly flySpeed: number;
  private readonly acceleration: number;
  private readonly airControl: number;
  /** Cached eye position to avoid per-frame allocation. */
  private readonly eye: Vec3;

  constructor(opts: PlayerOptions) {
    this.body = opts.body;
    this.eyeHeight = opts.eyeHeight;
    this.walkSpeed = opts.walkSpeed;
    this.sprintSpeed = opts.sprintSpeed;
    this.jumpVelocity = opts.jumpVelocity;
    this.flySpeed = opts.flySpeed;
    this.acceleration = opts.acceleration ?? 50;
    this.airControl = opts.airControl ?? 0.3;
    this.mode = 'walk';
    this.yaw = 0;
    this.eye = { x: 0, y: 0, z: 0 };
  }

  /** World-space eye position = body feet position + (0, eyeHeight, 0). */
  get eyePosition(): Vec3 {
    const p = this.body.position;
    this.eye.x = p.x;
    this.eye.y = p.y + this.eyeHeight;
    this.eye.z = p.z;
    return this.eye;
  }

  /**
   * Apply `input` for one frame, driving the body against `collider`.
   * Dispatches to walk or fly logic based on {@link mode}.
   */
  update(dt: number, input: PlayerInput, collider: VoxelCollider): void {
    if (this.mode === 'fly') {
      this.updateFly(dt, input, collider);
    } else {
      this.updateWalk(dt, input, collider);
    }
  }

  private updateWalk(dt: number, input: PlayerInput, collider: VoxelCollider): void {
    const { dx, dz } = this.moveDir(input.forward, input.right);
    const speed = input.sprint ? this.sprintSpeed : this.walkSpeed;
    const len = Math.hypot(dx, dz);
    const targetVx = len > 1e-6 ? (dx / len) * speed : 0;
    const targetVz = len > 1e-6 ? (dz / len) * speed : 0;
    // Reduced acceleration when airborne (air control).
    const accel = this.body.onGround ? this.acceleration : this.acceleration * this.airControl;
    const t = 1 - Math.exp(-accel * dt);
    const v = this.body.velocity;
    v.x += (targetVx - v.x) * t;
    v.z += (targetVz - v.z) * t;
    if (input.jump && this.body.onGround) {
      this.body.applyImpulse({ x: 0, y: this.jumpVelocity, z: 0 });
    }
    this.body.step(dt, collider);
  }

  private updateFly(dt: number, input: PlayerInput, collider: VoxelCollider): void {
    const { dx, dz } = this.moveDir(input.forward, input.right);
    let dy = 0;
    if (input.jump) dy += 1;
    if (input.sprint) dy -= 1;
    if (input.crouch) dy -= 1;
    const len = Math.hypot(dx, dy, dz);
    const v = this.body.velocity;
    if (len > 1e-6) {
      const s = this.flySpeed / len;
      v.x = dx * s;
      v.y = dy * s;
      v.z = dz * s;
    } else {
      v.x = 0;
      v.y = 0;
      v.z = 0;
    }
    // No gravity in fly mode — collision-only movement.
    this.body.move(dt, collider);
  }

  /**
   * Convert camera-space (forward, right) into a world-space horizontal
   * direction using {@link yaw}.
   *
   * forward = (-sin(yaw), 0, -cos(yaw)); right = (cos(yaw), 0, -sin(yaw)).
   */
  private moveDir(forward: number, right: number): { dx: number; dz: number } {
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    const dx = -sin * forward + cos * right;
    const dz = -cos * forward - sin * right;
    return { dx, dz };
  }
}
