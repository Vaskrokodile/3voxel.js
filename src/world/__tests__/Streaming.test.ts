import { describe, it, expect } from 'vitest';
import { Streaming } from '../Streaming.js';
import type { ChunkCoord } from '../../core/types.js';

describe('Streaming', () => {
  it('returns desired chunks sorted by distance to camera (nearest first)', () => {
    const s = new Streaming({ viewDistance: 3, maxPerFrame: 4, unloadMargin: 1 });
    const cam: ChunkCoord = { x: 0, y: 0, z: 0 };
    const desired = s.computeDesired(cam);
    expect(desired.length).toBeGreaterThan(0);
    // First entry is the camera chunk itself (distance 0).
    expect(desired[0]).toEqual({ x: 0, y: 0, z: 0 });
    // Distances are non-decreasing.
    const dist2 = (c: ChunkCoord) => c.x * c.x + c.y * c.y + c.z * c.z;
    for (let i = 1; i < desired.length; i++) {
      expect(dist2(desired[i]!)).toBeGreaterThanOrEqual(dist2(desired[i - 1]!));
    }
  });

  it('uses a sphere: corner chunks excluded for small viewDistance', () => {
    // viewDistance=1 sphere should include only the 7 chunks within radius 1
    // (the center + 6 face-neighbors); the 12 edge and 8 corner chunks at
    // distance sqrt(2) or sqrt(3) are excluded.
    const s = new Streaming({ viewDistance: 1, maxPerFrame: 4, unloadMargin: 1 });
    const desired = s.computeDesired({ x: 0, y: 0, z: 0 });
    // center + 6 face neighbors = 7
    expect(desired.length).toBe(7);
    for (const c of desired) {
      const d2 = c.x * c.x + c.y * c.y + c.z * c.z;
      expect(d2).toBeLessThanOrEqual(1);
    }
  });

  it('shouldUnload is true beyond viewDistance + unloadMargin', () => {
    const s = new Streaming({ viewDistance: 4, maxPerFrame: 4, unloadMargin: 2 });
    const cam: ChunkCoord = { x: 0, y: 0, z: 0 };
    expect(s.shouldUnload({ x: 7, y: 0, z: 0 }, cam)).toBe(true); // 7 > 4+2
    expect(s.shouldUnload({ x: 6, y: 0, z: 0 }, cam)).toBe(false); // 6 <= 6
    expect(s.shouldUnload({ x: 3, y: 0, z: 0 }, cam)).toBe(false);
  });

  it('shouldUnload uses Euclidean distance', () => {
    const s = new Streaming({ viewDistance: 3, maxPerFrame: 4, unloadMargin: 1 });
    const cam: ChunkCoord = { x: 0, y: 0, z: 0 };
    // (4,4,4) distance sqrt(48) ~ 6.9 > 4 => unload
    expect(s.shouldUnload({ x: 4, y: 4, z: 4 }, cam)).toBe(true);
    // (2,2,2) distance sqrt(12) ~ 3.46 <= 4 => keep
    expect(s.shouldUnload({ x: 2, y: 2, z: 2 }, cam)).toBe(false);
  });
});
