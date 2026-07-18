import type { AABB, Vec3 } from '../core/types.js';
import type { VoxelCollider } from './VoxelCollider.js';

/** Construction options for a {@link RigidBody}. */
export interface RigidBodyOptions {
  /** World-space position of the body's AABB min corner (feet). */
  position: Vec3;
  /** Half-size of the AABB. e.g. (0.3, 0.9, 0.3) for a 0.6x1.8x0.6 player. */
  halfExtents: Vec3;
  /** Vertical acceleration in blocks/s². Default -28. */
  gravity?: number;
  /**
   * Horizontal velocity damping factor applied once per step.
   * Default 0.85 (assumes a fixed ~60fps step; for variable dt prefer
   * `Math.pow(friction, dt*60)`).
   */
  friction?: number;
  /** Maximum speed magnitude in blocks/s. Default 50. */
  maxSpeed?: number;
  /** Mass in arbitrary units (unused by default forces, exposed for future
   * impulse/momentum extensions). Default 1. */
  mass?: number;
}

/**
 * A physics body with gravity that collides against the voxel grid.
 *
 * `position` is the AABB **min corner** (the feet), matching the Minecraft
 * entity convention. The AABB spans `position` to `position + 2*halfExtents`.
 *
 * Collision uses the axis-separated approach (move X, then Z, then Y,
 * reverting on overlap) rather than a continuous swept test. This is the
 * standard voxel-game technique because the world is block-aligned: discrete
 * overlap tests per axis are cheap, give stable resting contact, and avoid
 * the complexity/edge-cases of swept CCD on an integer grid. Swept collision
 * (see {@link VoxelCollider.sweep}) is reserved for queries like ray-picking.
 *
 * The `step` hot path performs no heap allocations: a reusable AABB is
 * updated in place before each overlap test.
 */
export class RigidBody {
  /** AABB min corner (feet position). Mutated by {@link step}. */
  readonly position: Vec3;
  /** Current velocity in blocks/s. Mutated by {@link step}. */
  readonly velocity: Vec3;
  /** Half-size of the AABB (read-only after construction). */
  readonly halfExtents: Vec3;
  /** True when the body is resting on a solid surface this step. */
  onGround: boolean;
  /** Mass in arbitrary units (default 1). */
  readonly mass: number;

  private readonly gravity: number;
  private readonly friction: number;
  private readonly maxSpeed: number;
  private readonly halfW: number;
  private readonly halfH: number;
  private readonly halfD: number;
  /** Reusable AABB for overlap tests — never re-allocated. */
  private readonly bounds: AABB;

  constructor(opts: RigidBodyOptions) {
    this.position = { x: opts.position.x, y: opts.position.y, z: opts.position.z };
    this.velocity = { x: 0, y: 0, z: 0 };
    this.halfExtents = { x: opts.halfExtents.x, y: opts.halfExtents.y, z: opts.halfExtents.z };
    this.gravity = opts.gravity ?? -28;
    this.friction = opts.friction ?? 0.85;
    this.maxSpeed = opts.maxSpeed ?? 50;
    this.mass = opts.mass ?? 1;
    this.onGround = false;
    this.halfW = opts.halfExtents.x * 2;
    this.halfH = opts.halfExtents.y * 2;
    this.halfD = opts.halfExtents.z * 2;
    this.bounds = { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } };
  }

  /** Add `impulse` to the current velocity (e.g. a jump). */
  applyImpulse(impulse: Vec3): void {
    this.velocity.x += impulse.x;
    this.velocity.y += impulse.y;
    this.velocity.z += impulse.z;
  }

  /** Replace the horizontal (X/Z) velocity components (player input). */
  setHorizontalVelocity(vx: number, vz: number): void {
    this.velocity.x = vx;
    this.velocity.z = vz;
  }

  /**
   * Integrate one physics step with gravity, friction, speed clamping, and
   * axis-separated collision against the voxel world via `collider`.
   */
  step(dt: number, collider: VoxelCollider): void {
    const v = this.velocity;
    // Gravity.
    v.y += this.gravity * dt;
    // Horizontal friction (per step).
    v.x *= this.friction;
    v.z *= this.friction;
    // Clamp overall speed.
    const sp = Math.hypot(v.x, v.y, v.z);
    if (sp > this.maxSpeed) {
      const s = this.maxSpeed / sp;
      v.x *= s;
      v.y *= s;
      v.z *= s;
    }
    this.move(dt, collider);
  }

  /**
   * Axis-separated collision movement WITHOUT forces (no gravity, no
   * friction, no clamping). Moves X, then Z, then Y, reverting the axis
   * and zeroing that velocity component on overlap. Sets {@link onGround}
   * when a downward Y move is blocked.
   *
   * Exposed so fly-mode controllers can move with collision but without
   * gravity. Walk mode should call {@link step} instead.
   */
  move(dt: number, collider: VoxelCollider): void {
    const v = this.velocity;
    const p = this.position;

    // X axis.
    if (v.x !== 0) {
      p.x += v.x * dt;
      this.updateBounds();
      if (collider.intersectsSolid(this.bounds)) {
        p.x -= v.x * dt;
        v.x = 0;
        this.updateBounds();
      }
    }

    // Z axis.
    if (v.z !== 0) {
      p.z += v.z * dt;
      this.updateBounds();
      if (collider.intersectsSolid(this.bounds)) {
        p.z -= v.z * dt;
        v.z = 0;
        this.updateBounds();
      }
    }

    // Y axis.
    if (v.y !== 0) {
      p.y += v.y * dt;
      this.updateBounds();
      if (collider.intersectsSolid(this.bounds)) {
        if (v.y < 0) {
          this.onGround = true;
        }
        p.y -= v.y * dt;
        v.y = 0;
        this.updateBounds();
      } else {
        // In the air (clear vertical move).
        this.onGround = false;
      }
    }
  }

  /** Write the current position + half-extents into the reusable AABB. */
  private updateBounds(): void {
    const p = this.position;
    const b = this.bounds;
    b.min.x = p.x;
    b.min.y = p.y;
    b.min.z = p.z;
    b.max.x = p.x + this.halfW;
    b.max.y = p.y + this.halfH;
    b.max.z = p.z + this.halfD;
  }
}
