/**
 * Custom (non-cube) block models — phase 1.
 *
 * A {@link BlockModel} is a list of axis-aligned boxes in voxel-local space
 * (coordinates in [0, 1]). The {@link ModelMesher} emits each box's six faces
 * as geometry, so a single block can represent non-cube shapes like lanterns,
 * torii beams, roof tiles, etc.
 *
 * Phase 1 limitations (deferred to phase 2):
 *   - No face culling between a model's own boxes (all six faces of every box
 *     are emitted; minor overdraw).
 *   - No neighbor culling against adjacent blocks.
 *   - UVs are 0..1 per face (one atlas tile per face), not per-box-tileable.
 *   - Models are meshed on the main thread at chunk-upload time, not in the
 *     worker (the worker protocol is unchanged).
 */

/** An axis-aligned box in voxel-local coordinates (each component in [0, 1]). */
export interface ModelBox {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
}

/** A block model: a collection of {@link ModelBox}es. */
export interface BlockModel {
  readonly boxes: readonly ModelBox[];
}

/** Registry of block-id → {@link BlockModel}. */
export class BlockModelRegistry {
  private readonly models = new Map<number, BlockModel>();

  /** Register a model for a block id (replaces any existing entry). */
  public set(blockId: number, model: BlockModel): void {
    this.models.set(blockId, model);
  }

  /** Look up the model for a block id, or `undefined` if none. */
  public get(blockId: number): BlockModel | undefined {
    return this.models.get(blockId);
  }

  /** Whether a block id has a registered model. */
  public has(blockId: number): boolean {
    return this.models.has(blockId);
  }
}

// ---- Built-in models (seed set for the sanctuary, phase 4) ----------------

/**
 * A stone lantern (tōrō) base+body+cap in one block. Compact and emissive-ready
 * (emissive handled in the shader via block id in phase 2).
 */
export const LANTERN_MODEL: BlockModel = {
  boxes: [
    // Base slab.
    { min: [0.15, 0.0, 0.15], max: [0.85, 0.1, 0.85] },
    // Body pillar.
    { min: [0.35, 0.1, 0.35], max: [0.65, 0.6, 0.65] },
    // Light chamber (slightly larger, will glow via material in phase 2).
    { min: [0.25, 0.6, 0.25], max: [0.75, 0.85, 0.75] },
    // Cap / roof.
    { min: [0.1, 0.85, 0.1], max: [0.9, 0.95, 0.9] },
    // Top knob.
    { min: [0.42, 0.95, 0.42], max: [0.58, 1.0, 0.58] },
  ],
};

/**
 * A thin pillar (for torii gate legs or fence posts). Full height, 0.2×0.2.
 */
export const PILLAR_MODEL: BlockModel = {
  boxes: [
    { min: [0.4, 0.0, 0.4], max: [0.6, 1.0, 0.6] },
  ],
};

/**
 * A horizontal beam spanning the block (for torii top beam / lintel).
 * Full width along X, thin in Y and Z.
 */
export const BEAM_MODEL: BlockModel = {
  boxes: [
    { min: [0.0, 0.4, 0.4], max: [1.0, 0.6, 0.6] },
  ],
};
