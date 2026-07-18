import type { RigidBody } from './RigidBody.js';
import type { VoxelCollider } from './VoxelCollider.js';

/**
 * Container that drives a set of {@link RigidBody} instances against a shared
 * voxel collider.
 *
 * The world owns no simulation state of its own — it is a thin orchestrator
 * around {@link RigidBody.step} so callers can advance every body with a
 * single `step(dt)` call. Bodies are referenced, not copied: mutating a
 * body's velocity/position outside the world is reflected on the next step.
 */
export class PhysicsWorld {
  private readonly collider: VoxelCollider;
  private readonly bodies: RigidBody[] = [];

  constructor(collider: VoxelCollider) {
    this.collider = collider;
  }

  /** Number of bodies currently in the world. */
  get bodyCount(): number {
    return this.bodies.length;
  }

  /** Register a body so it is advanced by {@link step}. Returns the body. */
  addBody(body: RigidBody): RigidBody {
    if (!this.bodies.includes(body)) this.bodies.push(body);
    return body;
  }

  /** Remove a previously added body. Returns true if it was present. */
  removeBody(body: RigidBody): boolean {
    const i = this.bodies.indexOf(body);
    if (i < 0) return false;
    this.bodies.splice(i, 1);
    return true;
  }

  /** Remove every body. */
  clear(): void {
    this.bodies.length = 0;
  }

  /**
   * Advance every body by `dt`, applying gravity and resolving voxel
   * collisions via the shared collider. Bodies are stepped in insertion
   * order; each body is independent (no body-body interaction yet).
   */
  step(dt: number): void {
    if (dt <= 0) return;
    for (let i = 0; i < this.bodies.length; i++) {
      this.bodies[i]!.step(dt, this.collider);
    }
  }
}
