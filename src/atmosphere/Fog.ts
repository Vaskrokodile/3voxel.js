/**
 * Distance fog for the world renderer.
 *
 * Fog blends distant chunks into the sky color, hiding the chunk loading
 * boundary and adding atmosphere. Uses a simple linear interpolation between
 * `near` and `far` distances.
 */

import type { Vec3 } from '../core/types.js';

/** Options for constructing a {@link Fog} instance. */
export interface FogOptions {
  /** Fog start distance (world units). No fog before this. */
  readonly near: number;
  /** Fog end distance (world units). Fully fogged beyond this. */
  readonly far: number;
  /** Fog color (should match the sky horizon color). */
  readonly color: Vec3;
}

/**
 * Linear distance fog.
 *
 * The fog factor is `clamp((distance - near) / (far - near), 0, 1)`:
 *   - 0 = no fog (object fully visible)
 *   - 1 = fully fogged (object replaced by fog color)
 */
export class Fog {
  /** Fog start distance (world units). No fog before this. */
  public near: number;
  /** Fog end distance (world units). Fully fogged beyond this. */
  public far: number;
  /** Fog color (should match the sky horizon color). */
  public color: Vec3;

  public constructor(opts: FogOptions) {
    this.near = opts.near;
    this.far = opts.far;
    this.color = { x: opts.color.x, y: opts.color.y, z: opts.color.z };
  }

  /**
   * Compute the fog factor [0, 1] for a given distance.
   * 0 = no fog (object fully visible), 1 = fully fogged.
   */
  public factor(distance: number): number {
    const range = this.far - this.near;
    if (range <= 0) {
      return distance >= this.far ? 1 : 0;
    }
    const f = (distance - this.near) / range;
    if (f < 0) return 0;
    if (f > 1) return 1;
    return f;
  }
}

/**
 * Generate a WGSL snippet that applies linear fog to a fragment color.
 *
 * The fog parameters (`near`, `far`, `color`) are baked into the returned
 * string as literals, so the world fragment shader can include this snippet
 * directly without additional uniform bindings.
 *
 * @param fog The fog configuration to bake in.
 * @returns WGSL source defining `applyFog(color, worldPos, cameraPos)`.
 */
export function fogWgslSnippet(fog: Fog): string {
  const r = trimFloat(fog.color.x);
  const g = trimFloat(fog.color.y);
  const b = trimFloat(fog.color.z);
  const near = trimFloat(fog.near);
  const far = trimFloat(fog.far);
  return `fn applyFog(color: vec3<f32>, worldPos: vec3<f32>, cameraPos: vec3<f32>) -> vec3<f32> {
  let dist = distance(worldPos, cameraPos);
  let factor = clamp((dist - ${near}) / (${far} - ${near}), 0.0, 1.0);
  return mix(color, vec3<f32>(${r}, ${g}, ${b}), factor);
}`;
}

/** Format a number as a WGSL float literal with minimal but valid precision. */
function trimFloat(n: number): string {
  if (Number.isNaN(n)) return '0.0';
  if (Number.isFinite(n)) {
    const s = n.toString();
    if (s.includes('.') || s.includes('e') || s.includes('E')) return s;
    return s + '.0';
  }
  return '0.0';
}
