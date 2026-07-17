import { AIR, CHUNK_SIZE, type AABB, type BlockId, type ChunkCoord } from '../core/types.js';
import { aabbIntersectsAabb } from '../core/math/AABB.js';
import type { RaycastHit } from './VoxelRaycaster.js';

/**
 * Minimal world view required by the {@link BlockEditor}. Deliberately does
 * NOT import {@link VoxelWorld} so the editor stays decoupled and testable.
 */
export interface BlockEditorWorld {
  /** Get the block id at a world coordinate. */
  getBlock(wx: number, wy: number, wz: number): BlockId;
  /** Set the block id at a world coordinate. */
  setBlock(wx: number, wy: number, wz: number, id: BlockId): void;
}

/** Options for constructing a {@link BlockEditor}. */
export interface BlockEditorOptions {
  /** World to read/write blocks from. */
  readonly world: BlockEditorWorld;
  /**
   * Called when a chunk's blocks change so the game can re-mesh that chunk
   * (and, for border blocks, its neighbors).
   */
  readonly onChunkDirty: (chunkCoord: ChunkCoord) => void;
}

/**
 * Edits blocks in a {@link BlockEditorWorld} with neighbor-aware chunk
 * dirty notification.
 *
 * Every successful edit computes the owning chunk coordinate
 * (`Math.floor(coord / CHUNK_SIZE)`) and fires {@link BlockEditorOptions.onChunkDirty}.
 * {@link BlockEditor.placeBlock} additionally notifies neighboring chunks
 * when the edited block lies on a chunk border, since border faces of the
 * neighbor may need re-meshing.
 */
export class BlockEditor {
  private readonly world: BlockEditorWorld;
  private readonly onChunkDirty: (chunkCoord: ChunkCoord) => void;

  constructor(opts: BlockEditorOptions) {
    this.world = opts.world;
    this.onChunkDirty = opts.onChunkDirty;
  }

  /**
   * Break (set to AIR) the block at world coord `(wx, wy, wz)`.
   * Notifies the owning chunk as dirty. Returns `true` if the block was
   * changed (i.e. it was not already AIR), `false` otherwise.
   */
  breakBlock(wx: number, wy: number, wz: number): boolean {
    const id = this.world.getBlock(wx, wy, wz);
    if (id === AIR) {
      return false;
    }
    this.world.setBlock(wx, wy, wz, AIR);
    this.notifyDirty(wx, wy, wz);
    return true;
  }

  /**
   * Place a block of id `id` at world coord `(wx, wy, wz)`.
   *
   * Notifies the owning chunk as dirty, and — when the block lies on a chunk
   * border (local coord 0 or `CHUNK_SIZE - 1` on any axis) — also notifies the
   * adjacent chunk on that side so its border faces re-mesh.
   *
   * Returns `true` if the block was placed, `false` if the target was not AIR
   * (refuses to overwrite a solid block).
   */
  placeBlock(wx: number, wy: number, wz: number, id: BlockId): boolean {
    if (id === AIR) {
      return false;
    }
    const existing = this.world.getBlock(wx, wy, wz);
    if (existing !== AIR) {
      return false;
    }
    this.world.setBlock(wx, wy, wz, id);
    this.notifyDirtyWithNeighbors(wx, wy, wz);
    return true;
  }

  /**
   * Break the block targeted by a raycast hit. Returns `true` on success.
   */
  breakAt(hit: RaycastHit): boolean {
    return this.breakBlock(hit.block.x, hit.block.y, hit.block.z);
  }

  /**
   * Place a block of id `id` adjacent to a raycast hit, on the side of the
   * hit face normal (i.e. at `hit.block + hit.normal`).
   *
   * Refuses to place if the target cell is not AIR, or — when `playerAabb` is
   * provided — if the new block's AABB would overlap the player's AABB
   * (prevents placing a block inside yourself).
   *
   * Returns `true` on success.
   */
  placeAt(hit: RaycastHit, id: BlockId, playerAabb?: AABB): boolean {
    const tx = hit.block.x + hit.normal.x;
    const ty = hit.block.y + hit.normal.y;
    const tz = hit.block.z + hit.normal.z;

    if (playerAabb !== undefined) {
      const blockAabb: AABB = {
        min: { x: tx, y: ty, z: tz },
        max: { x: tx + 1, y: ty + 1, z: tz + 1 },
      };
      if (aabbIntersectsAabb(blockAabb, playerAabb)) {
        return false;
      }
    }

    return this.placeBlock(tx, ty, tz, id);
  }

  /** Notify the owning chunk of an edit at the given world coord. */
  private notifyDirty(wx: number, wy: number, wz: number): void {
    const cx = Math.floor(wx / CHUNK_SIZE);
    const cy = Math.floor(wy / CHUNK_SIZE);
    const cz = Math.floor(wz / CHUNK_SIZE);
    this.onChunkDirty({ x: cx, y: cy, z: cz });
  }

  /**
   * Notify the owning chunk, plus any neighboring chunks that share a border
   * face with the edited block (local coord 0 or CHUNK_SIZE-1 on an axis).
   */
  private notifyDirtyWithNeighbors(wx: number, wy: number, wz: number): void {
    const cx = Math.floor(wx / CHUNK_SIZE);
    const cy = Math.floor(wy / CHUNK_SIZE);
    const cz = Math.floor(wz / CHUNK_SIZE);
    const lx = wx - cx * CHUNK_SIZE;
    const ly = wy - cy * CHUNK_SIZE;
    const lz = wz - cz * CHUNK_SIZE;

    this.onChunkDirty({ x: cx, y: cy, z: cz });

    if (lx === 0) {
      this.onChunkDirty({ x: cx - 1, y: cy, z: cz });
    } else if (lx === CHUNK_SIZE - 1) {
      this.onChunkDirty({ x: cx + 1, y: cy, z: cz });
    }

    if (ly === 0) {
      this.onChunkDirty({ x: cx, y: cy - 1, z: cz });
    } else if (ly === CHUNK_SIZE - 1) {
      this.onChunkDirty({ x: cx, y: cy + 1, z: cz });
    }

    if (lz === 0) {
      this.onChunkDirty({ x: cx, y: cy, z: cz - 1 });
    } else if (lz === CHUNK_SIZE - 1) {
      this.onChunkDirty({ x: cx, y: cy, z: cz + 1 });
    }
  }
}
