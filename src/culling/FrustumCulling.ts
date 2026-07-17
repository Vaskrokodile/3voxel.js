/**
 * CPU frustum-vs-AABB culling.
 *
 * The culler is decoupled from any specific frustum representation: it takes a
 * {@link FrustumLike} that knows how to test a single AABB. This makes it
 * trivially testable with a fake frustum and lets the renderer swap in a
 * real extracted-frustum without touching this module.
 */
import type { AABB } from '../core/types.js';

/**
 * Minimal frustum contract: "can you tell me whether this AABB is visible?"
 */
export interface FrustumLike {
  intersectsAabb(aabb: AABB): boolean;
}

/** A single cullable item: a stable id plus its world-space AABB. */
export interface CullItem {
  readonly id: number;
  readonly aabb: AABB;
}

/**
 * Culls a list of {@link CullItem}s against a frustum.
 *
 * Pure: the same input + frustum always yields the same output. The returned
 * array is a new array (input is not mutated) preserving input order.
 */
export class FrustumCuller {
  private readonly frustum: FrustumLike;

  constructor(frustum: FrustumLike) {
    this.frustum = frustum;
  }

  /** Returns the subset of `items` whose AABB intersects the frustum. */
  cull(items: CullItem[]): CullItem[] {
    const out: CullItem[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i]!;
      if (this.frustum.intersectsAabb(item.aabb)) {
        out.push(item);
      }
    }
    return out;
  }
}
