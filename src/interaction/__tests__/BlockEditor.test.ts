import { describe, it, expect } from 'vitest';
import { AIR, CHUNK_SIZE, type BlockId, type ChunkCoord } from '../../core/types.js';
import { BlockEditor, type BlockEditorWorld } from '../BlockEditor.js';
import type { RaycastHit } from '../VoxelRaycaster.js';

/** In-memory world backed by a Map. */
class FakeWorld implements BlockEditorWorld {
  readonly blocks = new Map<string, BlockId>();

  private key(x: number, y: number, z: number): string {
    return `${x},${y},${z}`;
  }

  set(x: number, y: number, z: number, id: BlockId): void {
    this.blocks.set(this.key(x, y, z), id);
  }

  getBlock(wx: number, wy: number, wz: number): BlockId {
    return this.blocks.get(this.key(wx, wy, wz)) ?? AIR;
  }

  setBlock(wx: number, wy: number, wz: number, id: BlockId): void {
    if (id === AIR) {
      this.blocks.delete(this.key(wx, wy, wz));
    } else {
      this.blocks.set(this.key(wx, wy, wz), id);
    }
  }
}

/** Records every chunk coord reported dirty. */
class DirtyTracker {
  readonly calls: ChunkCoord[] = [];

  readonly fn = (coord: ChunkCoord): void => {
    this.calls.push({ x: coord.x, y: coord.y, z: coord.z });
  };

  clear(): void {
    this.calls.length = 0;
  }

  countFor(coord: ChunkCoord): number {
    return this.calls.filter(
      (c) => c.x === coord.x && c.y === coord.y && c.z === coord.z,
    ).length;
  }
}

const STONE = 1;

describe('BlockEditor', () => {
  it('breakBlock sets the block to AIR and notifies the owning chunk', () => {
    const world = new FakeWorld();
    world.set(5, 0, 5, STONE);
    const tracker = new DirtyTracker();
    const editor = new BlockEditor({ world, onChunkDirty: tracker.fn });

    const ok = editor.breakBlock(5, 0, 5);
    expect(ok).toBe(true);
    expect(world.getBlock(5, 0, 5)).toBe(AIR);
    // (5,0,5) -> chunk (0,0,0).
    expect(tracker.calls).toContainEqual({ x: 0, y: 0, z: 0 });
  });

  it('breakBlock returns false and does not notify when already AIR', () => {
    const world = new FakeWorld();
    const tracker = new DirtyTracker();
    const editor = new BlockEditor({ world, onChunkDirty: tracker.fn });

    const ok = editor.breakBlock(5, 0, 5);
    expect(ok).toBe(false);
    expect(tracker.calls).toHaveLength(0);
  });

  it('placeBlock sets the block and notifies the owning chunk', () => {
    const world = new FakeWorld();
    const tracker = new DirtyTracker();
    const editor = new BlockEditor({ world, onChunkDirty: tracker.fn });

    const ok = editor.placeBlock(5, 0, 5, STONE);
    expect(ok).toBe(true);
    expect(world.getBlock(5, 0, 5)).toBe(STONE);
    expect(tracker.calls).toContainEqual({ x: 0, y: 0, z: 0 });
  });

  it('placeBlock refuses to overwrite a solid block', () => {
    const world = new FakeWorld();
    world.set(5, 0, 5, STONE);
    const tracker = new DirtyTracker();
    const editor = new BlockEditor({ world, onChunkDirty: tracker.fn });

    const ok = editor.placeBlock(5, 0, 5, 2);
    expect(ok).toBe(false);
    expect(world.getBlock(5, 0, 5)).toBe(STONE);
    expect(tracker.calls).toHaveLength(0);
  });

  it('placeBlock on a chunk border (local 0) notifies the neighbor chunk too', () => {
    const world = new FakeWorld();
    const tracker = new DirtyTracker();
    const editor = new BlockEditor({ world, onChunkDirty: tracker.fn });

    // x = 0 -> chunk 0, local 0 -> neighbor chunk x = -1.
    const ok = editor.placeBlock(0, 0, 0, STONE);
    expect(ok).toBe(true);
    expect(tracker.countFor({ x: 0, y: 0, z: 0 })).toBe(1);
    expect(tracker.countFor({ x: -1, y: 0, z: 0 })).toBe(1);
    // y and z are local 0 as well, so those neighbors too.
    expect(tracker.countFor({ x: 0, y: -1, z: 0 })).toBe(1);
    expect(tracker.countFor({ x: 0, y: 0, z: -1 })).toBe(1);
  });

  it('placeBlock on a chunk border (local CHUNK_SIZE-1) notifies the +1 neighbor', () => {
    const world = new FakeWorld();
    const tracker = new DirtyTracker();
    const editor = new BlockEditor({ world, onChunkDirty: tracker.fn });

    const bx = CHUNK_SIZE - 1; // local 15 in chunk 0 -> neighbor chunk 1.
    const ok = editor.placeBlock(bx, 5, 5, STONE);
    expect(ok).toBe(true);
    expect(tracker.countFor({ x: 0, y: 0, z: 0 })).toBe(1);
    expect(tracker.countFor({ x: 1, y: 0, z: 0 })).toBe(1);
    // y=5, z=5 are interior -> no y/z neighbor notifications.
    expect(tracker.calls).toHaveLength(2);
  });

  it('placeBlock in the chunk interior notifies only the owning chunk', () => {
    const world = new FakeWorld();
    const tracker = new DirtyTracker();
    const editor = new BlockEditor({ world, onChunkDirty: tracker.fn });

    const ok = editor.placeBlock(5, 5, 5, STONE); // all local 5, interior.
    expect(ok).toBe(true);
    expect(tracker.calls).toHaveLength(1);
    expect(tracker.calls[0]).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('breakAt breaks the block described by a raycast hit', () => {
    const world = new FakeWorld();
    world.set(5, 0, 5, STONE);
    const tracker = new DirtyTracker();
    const editor = new BlockEditor({ world, onChunkDirty: tracker.fn });

    const hit: RaycastHit = {
      block: { x: 5, y: 0, z: 5 },
      normal: { x: 0, y: 1, z: 0 },
      distance: 4.5,
      blockId: STONE,
    };
    const ok = editor.breakAt(hit);
    expect(ok).toBe(true);
    expect(world.getBlock(5, 0, 5)).toBe(AIR);
    expect(tracker.calls).toContainEqual({ x: 0, y: 0, z: 0 });
  });

  it('placeAt places a block adjacent to the hit on the normal side', () => {
    const world = new FakeWorld();
    world.set(5, 0, 5, STONE);
    const tracker = new DirtyTracker();
    const editor = new BlockEditor({ world, onChunkDirty: tracker.fn });

    const hit: RaycastHit = {
      block: { x: 5, y: 0, z: 5 },
      normal: { x: 0, y: 1, z: 0 },
      distance: 4.5,
      blockId: STONE,
    };
    const ok = editor.placeAt(hit, 2);
    expect(ok).toBe(true);
    // New block at hit.block + normal = (5,1,5).
    expect(world.getBlock(5, 1, 5)).toBe(2);
  });

  it('placeAt refuses to place where a solid block already exists', () => {
    const world = new FakeWorld();
    world.set(5, 0, 5, STONE);
    world.set(5, 1, 5, STONE); // target already occupied
    const tracker = new DirtyTracker();
    const editor = new BlockEditor({ world, onChunkDirty: tracker.fn });

    const hit: RaycastHit = {
      block: { x: 5, y: 0, z: 5 },
      normal: { x: 0, y: 1, z: 0 },
      distance: 4.5,
      blockId: STONE,
    };
    const ok = editor.placeAt(hit, 2);
    expect(ok).toBe(false);
    expect(world.getBlock(5, 1, 5)).toBe(STONE);
    expect(tracker.calls).toHaveLength(0);
  });

  it('placeAt refuses to place inside the player AABB', () => {
    const world = new FakeWorld();
    world.set(5, 0, 5, STONE);
    const tracker = new DirtyTracker();
    const editor = new BlockEditor({ world, onChunkDirty: tracker.fn });

    const hit: RaycastHit = {
      block: { x: 5, y: 0, z: 5 },
      normal: { x: 0, y: 1, z: 0 },
      distance: 4.5,
      blockId: STONE,
    };
    // Player AABB covers (5,1,5).
    const playerAabb = {
      min: { x: 5.2, y: 1.0, z: 5.2 },
      max: { x: 5.8, y: 2.8, z: 5.8 },
    };
    const ok = editor.placeAt(hit, 2, playerAabb);
    expect(ok).toBe(false);
    expect(world.getBlock(5, 1, 5)).toBe(AIR);
  });

  it('placeAt succeeds when the player AABB does not overlap the target', () => {
    const world = new FakeWorld();
    world.set(5, 0, 5, STONE);
    const tracker = new DirtyTracker();
    const editor = new BlockEditor({ world, onChunkDirty: tracker.fn });

    const hit: RaycastHit = {
      block: { x: 5, y: 0, z: 5 },
      normal: { x: 0, y: 1, z: 0 },
      distance: 4.5,
      blockId: STONE,
    };
    // Player AABB far from (5,1,5).
    const playerAabb = {
      min: { x: 10, y: 10, z: 10 },
      max: { x: 11, y: 12, z: 11 },
    };
    const ok = editor.placeAt(hit, 2, playerAabb);
    expect(ok).toBe(true);
    expect(world.getBlock(5, 1, 5)).toBe(2);
  });

  it('handles negative world coordinates correctly for chunk computation', () => {
    const world = new FakeWorld();
    const tracker = new DirtyTracker();
    const editor = new BlockEditor({ world, onChunkDirty: tracker.fn });

    // world -1 -> chunk floor(-1/16) = -1, local 15 (interior, no neighbor).
    const ok = editor.placeBlock(-1, -1, -1, STONE);
    expect(ok).toBe(true);
    expect(tracker.countFor({ x: -1, y: -1, z: -1 })).toBe(1);
    // local 15 is CHUNK_SIZE-1 -> +1 neighbors on every axis.
    expect(tracker.countFor({ x: 0, y: -1, z: -1 })).toBe(1);
    expect(tracker.countFor({ x: -1, y: 0, z: -1 })).toBe(1);
    expect(tracker.countFor({ x: -1, y: -1, z: 0 })).toBe(1);
  });
});
