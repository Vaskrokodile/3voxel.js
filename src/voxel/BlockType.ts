import { AIR, type BlockId } from '../core/types.js';

/**
 * Definition of a block type. Registered in a {@link BlockRegistry}.
 */
export interface BlockType {
  /** Unique id. 0 is reserved for AIR. */
  readonly id: BlockId;
  /** Human-readable name, unique within a registry. */
  readonly name: string;
  /** Whether the block has collision/solidity for physics. */
  readonly solid: boolean;
  /** Whether the block renders with transparency (e.g. water, glass). */
  readonly transparent: boolean;
  /**
   * Whether the block fully occludes the faces of neighbours (so the mesher
   * can cull adjacent faces). Opaque blocks have this true; transparent or
   * non-cube blocks typically false.
   */
  readonly opaqueFaces: boolean;
  /** Linear RGB color in 0..1, used for debug textures / flat shading. */
  readonly color: readonly [number, number, number];
  /** Mesh style: full cube, X-shaped cross (plants), or none (invisible). */
  readonly meshType: 'cube' | 'cross' | 'none';
}

/**
 * The AIR block type. id 0, non-solid, transparent, no mesh.
 * A registry auto-registers this at construction.
 */
export const AIR_BLOCK: BlockType = {
  id: AIR,
  name: 'air',
  solid: false,
  transparent: true,
  opaqueFaces: false,
  color: [0, 0, 0],
  meshType: 'none',
} as const;
