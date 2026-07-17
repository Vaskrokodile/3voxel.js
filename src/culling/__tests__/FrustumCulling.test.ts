import { describe, it, expect } from 'vitest';
import type { AABB } from '../../core/types.js';
import { FrustumCuller } from '../FrustumCulling.js';
import type { CullItem, FrustumLike } from '../FrustumCulling.js';

/** Fake frustum: visible iff item.id < threshold. Derives id from aabb.min.x. */
class IdThresholdFrustum implements FrustumLike {
  readonly threshold: number;
  constructor(threshold: number) {
    this.threshold = threshold;
  }
  intersectsAabb(aabb: AABB): boolean {
    // makeItem encodes the id as aabb.min.x.
    return aabb.min.x < this.threshold;
  }
}

/** Fake frustum that uses a visible-id set; derives id from aabb.min.x. */
class MappedFrustum implements FrustumLike {
  private readonly visible: Set<number>;
  constructor(visibleIds: number[]) {
    this.visible = new Set(visibleIds);
  }
  intersectsAabb(aabb: AABB): boolean {
    return this.visible.has(aabb.min.x);
  }
}

function makeItem(id: number): CullItem {
  return {
    id,
    aabb: {
      min: { x: id, y: 0, z: 0 },
      max: { x: id + 1, y: 1, z: 1 },
    },
  };
}

describe('FrustumCuller', () => {
  it('returns only items with id < 5', () => {
    const frustum = new IdThresholdFrustum(5);
    const culler = new FrustumCuller(frustum);
    const items = Array.from({ length: 10 }, (_, i) => makeItem(i));
    const visible = culler.cull(items);
    expect(visible.map((c) => c.id)).toEqual([0, 1, 2, 3, 4]);
  });

  it('preserves input order', () => {
    const frustum = new MappedFrustum([3, 1, 7]);
    const culler = new FrustumCuller(frustum);
    const items = Array.from({ length: 10 }, (_, i) => makeItem(i));
    const visible = culler.cull(items);
    // Input order is 0,1,2,...,9; visible ids {1,3,7} appear in that order.
    expect(visible.map((c) => c.id)).toEqual([1, 3, 7]);
  });

  it('returns empty array when nothing is visible', () => {
    const frustum = new MappedFrustum([]);
    const culler = new FrustumCuller(frustum);
    const items = Array.from({ length: 5 }, (_, i) => makeItem(i));
    expect(culler.cull(items)).toEqual([]);
  });

  it('returns all when everything is visible', () => {
    const frustum = new MappedFrustum([0, 1, 2]);
    const culler = new FrustumCuller(frustum);
    const items = Array.from({ length: 3 }, (_, i) => makeItem(i));
    expect(culler.cull(items).length).toBe(3);
  });

  it('does not mutate the input array', () => {
    const frustum = new MappedFrustum([0]);
    const culler = new FrustumCuller(frustum);
    const items = Array.from({ length: 3 }, (_, i) => makeItem(i));
    const snapshot = items.slice();
    culler.cull(items);
    expect(items).toEqual(snapshot);
  });
});
