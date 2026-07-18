/**
 * tdjs physics — voxel-grid collision and first-person player locomotion.
 *
 * Public surface:
 *  - {@link VoxelCollider}: AABB vs voxel world overlap + swept collision.
 *  - {@link RigidBody}: gravity-driven body with axis-separated collision.
 *  - {@link PlayerController}: walk/fly first-person controller.
 */
export {
  VoxelCollider,
  type VoxelColliderWorld,
  type SolidChecker,
  type CollisionResult,
} from './VoxelCollider.js';
export { RigidBody, type RigidBodyOptions } from './RigidBody.js';
export { PhysicsWorld } from './PhysicsWorld.js';
export {
  PlayerController,
  type PlayerMode,
  type PlayerOptions,
  type PlayerInput,
} from './PlayerController.js';
