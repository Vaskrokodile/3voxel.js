/**
 * Distance-based LOD tier selection.
 *
 * Pass 1 scope: only {@link LODTier.High} produces a distinct mesh (the full
 * 16^3 chunk mesh). Mid and Low tiers are RESERVED for future merged/LOD
 * meshes; for now `lodTierFor` may return Mid/Low to mark intent but the
 * mesher treats them identically to High. Cross-chunk neighbor meshing and
 * merged-LOD meshes are explicitly FUTURE WORK and are not faked here.
 */
import type { ChunkCoord, Vec3 } from '../core/types.js';
import { CHUNK_SIZE } from '../core/types.js';

/** LOD tiers. Only High has a distinct mesh in pass 1. */
export enum LODTier {
  /** Full-resolution 16^3 chunk mesh. */
  High = 0,
  /** Reserved: future merged/decimated mesh. Currently meshes as High. */
  Mid = 1,
  /** Reserved: future coarse merged mesh. Currently meshes as High. */
  Low = 2,
}

/**
 * Pick an LOD tier for a chunk relative to the camera, or `null` when the
 * chunk is entirely outside the view distance.
 *
 * Distance is measured in chunk-space (chunk-center to camera-position) and
 * compared against `viewDistance` in world units. Tier boundaries:
 *   - High: within 1/3 of viewDistance.
 *   - Mid:  within 2/3 of viewDistance.
 *   - Low:  within viewDistance.
 *   - null: beyond viewDistance.
 *
 * @param chunkCoord   The chunk's coordinate.
 * @param cameraPos    Camera world position.
 * @param viewDistance Render distance in world units.
 * @returns Tier or null if outside view distance.
 */
export function lodTierFor(
  chunkCoord: ChunkCoord,
  cameraPos: Vec3,
  viewDistance: number,
): LODTier | null {
  const cx = chunkCoord.x * CHUNK_SIZE + CHUNK_SIZE / 2;
  const cy = chunkCoord.y * CHUNK_SIZE + CHUNK_SIZE / 2;
  const cz = chunkCoord.z * CHUNK_SIZE + CHUNK_SIZE / 2;
  const dx = cx - cameraPos.x;
  const dy = cy - cameraPos.y;
  const dz = cz - cameraPos.z;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

  if (dist > viewDistance) return null;
  const third = viewDistance / 3;
  if (dist <= third) return LODTier.High;
  if (dist <= third * 2) return LODTier.Mid;
  return LODTier.Low;
}
