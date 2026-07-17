import type { BlockId, Vec3 } from '../core/types.js';

/**
 * Result of a voxel raycast: the first solid block intersected by the ray.
 */
export interface RaycastHit {
  /** World-space block coordinate that was hit. */
  readonly block: { x: number; y: number; z: number };
  /**
   * Face normal of the hit face, pointing back toward the ray origin.
   * (0,1,0) = top, (0,-1,0) = bottom, etc. (0,0,0) when the ray starts
   * inside a solid block.
   */
  readonly normal: Vec3;
  /** Distance from the ray origin to the hit point (in world units). */
  readonly distance: number;
  /** The block id that was hit. */
  readonly blockId: BlockId;
}

/**
 * Minimal world view required by the raycaster. Deliberately does NOT
 * import {@link VoxelWorld} so the raycaster stays decoupled and testable.
 */
export interface VoxelRaycastWorld {
  /** Get the block id at a world coordinate. */
  getBlock(wx: number, wy: number, wz: number): BlockId;
}

/**
 * Looks up whether a block id is solid. Typically backed by a
 * {@link BlockRegistry}; kept as a separate interface for decoupling.
 */
export interface SolidChecker {
  /** Get the block definition for `id`; `.solid` indicates ray collision. */
  get(id: BlockId): { solid: boolean };
}

/** Options for constructing a {@link VoxelRaycaster}. */
export interface VoxelRaycasterOptions {
  /** Maximum reach distance in world units (e.g. 6). */
  readonly maxDistance: number;
  /** Used to test whether a block id is solid (stops the ray). */
  readonly solidChecker: SolidChecker;
}

/**
 * Voxel-grid raycaster implementing the Amanatides-Woo DDA traversal
 * algorithm.
 *
 * Steps through every voxel cell intersected by the ray, in near-to-far
 * order, and returns the first cell whose block is solid. The face normal
 * is derived from the axis along which the ray entered the hit voxel.
 *
 * The hot path allocates only the returned {@link RaycastHit} object; all
 * traversal state is kept in local scalar variables.
 */
export class VoxelRaycaster {
  private readonly maxDistance: number;
  private readonly solidChecker: SolidChecker;

  constructor(opts: VoxelRaycasterOptions) {
    this.maxDistance = opts.maxDistance;
    this.solidChecker = opts.solidChecker;
  }

  /**
   * Cast a ray from `origin` in direction `dir` (must be normalized) and
   * return the first solid block hit within {@link VoxelRaycasterOptions.maxDistance},
   * or `null` if none.
   *
   * If the ray origin starts inside a solid block, that block is returned
   * immediately with a zero normal and zero distance.
   */
  cast(origin: Vec3, dir: Vec3, world: VoxelRaycastWorld): RaycastHit | null {
    const solidChecker = this.solidChecker;
    const maxDistance = this.maxDistance;

    // Current voxel index (floor handles negatives correctly).
    let x = Math.floor(origin.x);
    let y = Math.floor(origin.y);
    let z = Math.floor(origin.z);

    // Step direction per axis: sign of dir, or 0 when the ray is parallel.
    const stepX = dir.x > 0 ? 1 : dir.x < 0 ? -1 : 0;
    const stepY = dir.y > 0 ? 1 : dir.y < 0 ? -1 : 0;
    const stepZ = dir.z > 0 ? 1 : dir.z < 0 ? -1 : 0;

    // tDelta: t-distance to traverse one full voxel along each axis.
    const tDeltaX = dir.x !== 0 ? Math.abs(1 / dir.x) : Infinity;
    const tDeltaY = dir.y !== 0 ? Math.abs(1 / dir.y) : Infinity;
    const tDeltaZ = dir.z !== 0 ? Math.abs(1 / dir.z) : Infinity;

    // tMax: t-distance from origin to the first voxel boundary on each axis.
    let tMaxX: number;
    let tMaxY: number;
    let tMaxZ: number;

    if (stepX > 0) {
      tMaxX = (x + 1 - origin.x) / dir.x;
    } else if (stepX < 0) {
      tMaxX = (x - origin.x) / dir.x;
    } else {
      tMaxX = Infinity;
    }

    if (stepY > 0) {
      tMaxY = (y + 1 - origin.y) / dir.y;
    } else if (stepY < 0) {
      tMaxY = (y - origin.y) / dir.y;
    } else {
      tMaxY = Infinity;
    }

    if (stepZ > 0) {
      tMaxZ = (z + 1 - origin.z) / dir.z;
    } else if (stepZ < 0) {
      tMaxZ = (z - origin.z) / dir.z;
    } else {
      tMaxZ = Infinity;
    }

    // Face normal of the last-entered face; updated on each step.
    let normalX = 0;
    let normalY = 0;
    let normalZ = 0;

    // Check the starting voxel (origin may be inside a solid block).
    const startId = world.getBlock(x, y, z);
    if (startId !== 0 && solidChecker.get(startId).solid) {
      return {
        block: { x, y, z },
        normal: { x: 0, y: 0, z: 0 },
        distance: 0,
        blockId: startId,
      };
    }

    let t = 0;
    // Guard against pathological infinite loops.
    const maxSteps = Math.ceil(maxDistance / Math.min(tDeltaX, tDeltaY, tDeltaZ)) + 2;
    for (let step = 0; step < maxSteps; step++) {
      // Advance along the axis with the smallest tMax (nearest boundary).
      if (tMaxX < tMaxY) {
        if (tMaxX < tMaxZ) {
          x += stepX;
          t = tMaxX;
          tMaxX += tDeltaX;
          normalX = -stepX;
          normalY = 0;
          normalZ = 0;
        } else {
          z += stepZ;
          t = tMaxZ;
          tMaxZ += tDeltaZ;
          normalX = 0;
          normalY = 0;
          normalZ = -stepZ;
        }
      } else {
        if (tMaxY < tMaxZ) {
          y += stepY;
          t = tMaxY;
          tMaxY += tDeltaY;
          normalX = 0;
          normalY = -stepY;
          normalZ = 0;
        } else {
          z += stepZ;
          t = tMaxZ;
          tMaxZ += tDeltaZ;
          normalX = 0;
          normalY = 0;
          normalZ = -stepZ;
        }
      }

      if (t > maxDistance) {
        break;
      }

      const id = world.getBlock(x, y, z);
      if (id !== 0 && solidChecker.get(id).solid) {
        return {
          block: { x, y, z },
          normal: { x: normalX, y: normalY, z: normalZ },
          distance: t,
          blockId: id,
        };
      }
    }

    return null;
  }
}
