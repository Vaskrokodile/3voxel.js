import type { AABB, BlockId, Vec3 } from '../core/types.js';

/**
 * Minimal world view required by {@link VoxelCollider}.
 *
 * Intentionally does NOT import `VoxelWorld` so the physics module stays
 * decoupled from the voxel subsystem and can be tested with a fake.
 */
export interface VoxelColliderWorld {
  /** Return the block id at a world coordinate. 0 == AIR. */
  getBlock(wx: number, wy: number, wz: number): BlockId;
}

/**
 * Minimal block-solidity lookup required by {@link VoxelCollider}.
 * Mirrors the shape of `BlockRegistry.get(id)` without importing it.
 */
export interface SolidChecker {
  get(id: BlockId): { solid: boolean };
}

/** Result of a swept AABB collision query against the voxel grid. */
export interface CollisionResult {
  /** Whether a collision was found. */
  collided: boolean;
  /**
   * Unit normal of the collided face, or (0,0,0) if no collision or if the
   * AABB was already penetrating at the start of the sweep.
   */
  normal: Vec3;
  /**
   * Penetration depth: the distance the AABB would have traveled beyond the
   * contact point had it moved the full velocity. Zero when already touching.
   */
  depth: number;
}

/**
 * AABB-vs-voxel-grid collision queries.
 *
 * Two operations:
 *  - {@link intersectsSolid}: discrete overlap test (used every frame by
 *    `RigidBody.step`'s axis-separated movement).
 *  - {@link sweep}: continuous first-contact query via the expanded-AABB /
 *    ray-vs-box technique.
 */
export class VoxelCollider {
  private readonly world: VoxelColliderWorld;
  private readonly solidChecker: SolidChecker;

  constructor(world: VoxelColliderWorld, solidChecker: SolidChecker) {
    this.world = world;
    this.solidChecker = solidChecker;
  }

  /**
   * Check whether a world-space AABB overlaps any solid voxel.
   *
   * Iterates over every voxel cell the box overlaps — `floor(min)` to
   * `floor(max)` on each axis (typically 2-3 cells per axis, ~27 max). No
   * allocations on the hot path.
   */
  intersectsSolid(box: AABB): boolean {
    const minX = Math.floor(box.min.x);
    const maxX = Math.floor(box.max.x);
    const minY = Math.floor(box.min.y);
    const maxY = Math.floor(box.max.y);
    const minZ = Math.floor(box.min.z);
    const maxZ = Math.floor(box.max.z);

    for (let y = minY; y <= maxY; y++) {
      for (let z = minZ; z <= maxZ; z++) {
        for (let x = minX; x <= maxX; x++) {
          const id = this.world.getBlock(x, y, z);
          if (id !== 0 && this.solidChecker.get(id).solid) {
            return true;
          }
        }
      }
    }
    return false;
  }

  /**
   * Sweep an AABB along `velocity`, returning the first collision with a
   * solid voxel or `null` if the box can move the full distance.
   *
   * Uses the Minkowski expanded-AABB technique: each unit voxel is expanded
   * by the box's half-extents, reducing the problem to a ray-vs-AABB slab
   * test from the box center along the velocity vector. `t` is expressed as
   * a fraction of the velocity (0 == start, 1 == full move).
   */
  sweep(box: AABB, velocity: Vec3): CollisionResult | null {
    const vx = velocity.x;
    const vy = velocity.y;
    const vz = velocity.z;

    // No motion: report a static overlap if any.
    if (vx === 0 && vy === 0 && vz === 0) {
      if (this.intersectsSolid(box)) {
        return { collided: true, normal: { x: 0, y: 0, z: 0 }, depth: 0 };
      }
      return null;
    }

    const hx = (box.max.x - box.min.x) * 0.5;
    const hy = (box.max.y - box.min.y) * 0.5;
    const hz = (box.max.z - box.min.z) * 0.5;
    const cx = (box.min.x + box.max.x) * 0.5;
    const cy = (box.min.y + box.max.y) * 0.5;
    const cz = (box.min.z + box.max.z) * 0.5;

    // Range of voxels the swept box can touch.
    const minX = Math.floor(Math.min(box.min.x, box.min.x + vx));
    const maxX = Math.floor(Math.max(box.max.x, box.max.x + vx));
    const minY = Math.floor(Math.min(box.min.y, box.min.y + vy));
    const maxY = Math.floor(Math.max(box.max.y, box.max.y + vy));
    const minZ = Math.floor(Math.min(box.min.z, box.min.z + vz));
    const maxZ = Math.floor(Math.max(box.max.z, box.max.z + vz));

    const speed = Math.hypot(vx, vy, vz);
    let bestT = 1; // smallest entry fraction in [0,1]
    let bestAxis = -1; // 0=x, 1=y, 2=z
    let bestSign = 0; // normal sign on that axis
    let alreadyPenetrating = false;

    for (let y = minY; y <= maxY; y++) {
      for (let z = minZ; z <= maxZ; z++) {
        for (let x = minX; x <= maxX; x++) {
          const id = this.world.getBlock(x, y, z);
          if (id === 0 || !this.solidChecker.get(id).solid) continue;

          // Expanded voxel box (Minkowski sum of voxel and the AABB).
          const exMin = x - hx;
          const exMax = x + 1 + hx;
          const eyMin = y - hy;
          const eyMax = y + 1 + hy;
          const ezMin = z - hz;
          const ezMax = z + 1 + hz;

          // Slab method against the ray (center, velocity).
          let tmin = -Infinity;
          let tmax = Infinity;
          let entryAxis = -1;
          let entrySign = 0;

          // X
          if (Math.abs(vx) < 1e-12) {
            if (cx < exMin || cx > exMax) continue;
          } else {
            const inv = 1 / vx;
            let t1 = (exMin - cx) * inv;
            let t2 = (exMax - cx) * inv;
            const sign = vx > 0 ? -1 : 1;
            if (t1 > t2) {
              const tmp = t1;
              t1 = t2;
              t2 = tmp;
            }
            if (t1 > tmin) {
              tmin = t1;
              entryAxis = 0;
              entrySign = sign;
            }
            if (t2 < tmax) tmax = t2;
            if (tmin > tmax) continue;
          }

          // Y
          if (Math.abs(vy) < 1e-12) {
            if (cy < eyMin || cy > eyMax) continue;
          } else {
            const inv = 1 / vy;
            let t1 = (eyMin - cy) * inv;
            let t2 = (eyMax - cy) * inv;
            const sign = vy > 0 ? -1 : 1;
            if (t1 > t2) {
              const tmp = t1;
              t1 = t2;
              t2 = tmp;
            }
            if (t1 > tmin) {
              tmin = t1;
              entryAxis = 1;
              entrySign = sign;
            }
            if (t2 < tmax) tmax = t2;
            if (tmin > tmax) continue;
          }

          // Z
          if (Math.abs(vz) < 1e-12) {
            if (cz < ezMin || cz > ezMax) continue;
          } else {
            const inv = 1 / vz;
            let t1 = (ezMin - cz) * inv;
            let t2 = (ezMax - cz) * inv;
            const sign = vz > 0 ? -1 : 1;
            if (t1 > t2) {
              const tmp = t1;
              t1 = t2;
              t2 = tmp;
            }
            if (t1 > tmin) {
              tmin = t1;
              entryAxis = 2;
              entrySign = sign;
            }
            if (t2 < tmax) tmax = t2;
            if (tmin > tmax) continue;
          }

          // Box is entirely behind the ray start.
          if (tmax < 0) continue;
          // Ray starts inside the expanded box -> already penetrating.
          if (tmin < 0) {
            alreadyPenetrating = true;
            bestT = 0;
            bestAxis = -1;
            continue;
          }
          if (tmin <= bestT) {
            bestT = tmin;
            bestAxis = entryAxis;
            bestSign = entrySign;
          }
        }
      }
    }

    if (bestAxis < 0 && !alreadyPenetrating) {
      return null;
    }

    let normal: Vec3;
    if (bestAxis < 0) {
      normal = { x: 0, y: 0, z: 0 };
    } else {
      const n = [0, 0, 0];
      n[bestAxis] = bestSign;
      normal = { x: n[0]!, y: n[1]!, z: n[2]! };
    }
    const depth = (1 - bestT) * speed;
    return { collided: true, normal, depth };
  }
}
