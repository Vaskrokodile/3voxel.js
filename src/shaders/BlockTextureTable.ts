/**
 * Per-block face → atlas UV-rect table, uploaded as a uniform buffer and
 * sampled in the world fragment shader to pick the correct atlas tile per
 * face (top / bottom / side) without baking UVs into vertices.
 *
 * The face is derived in-shader from the vertex normal, so the mesher and
 * worker pipeline are untouched. A zero rect (u0=v0=u1=v1=0) signals "no
 * texture for this face" — the shader falls back to the flat color table.
 *
 * Uniform layout (std140-style, WGSL):
 *   struct BlockTextureTable { rects : array<vec4<f32>, MAX*3> };
 * Indexing: face 0 = top, 1 = bottom, 2 = side.
 *   rect = rects[blockId * 3 + face];   // (u0, v0, u1, v1)
 */

import type { UVRect } from './TextureAtlas.js';

/** Face indices used by the table and mirrored in the shader. */
export const FACE_TOP = 0;
export const FACE_BOTTOM = 1;
export const FACE_SIDE = 2;
export const FACES_PER_BLOCK = 3;

/** A face→texture-name assignment resolved against a {@link TextureAtlas}. */
export interface BlockFaceTextures {
  /** Texture name for the +Y face (top). Falls back to `side` if omitted. */
  readonly top?: string;
  /** Texture name for the -Y face (bottom). Falls back to `side` if omitted. */
  readonly bottom?: string;
  /** Texture name for the four side faces. */
  readonly side?: string;
}

/**
 * CPU-side table of per-block, per-face atlas UV rects.
 *
 * Build it by calling {@link BlockTextureTable.set} with resolved {@link UVRect}s
 * (typically obtained from a {@link TextureAtlas}), then upload
 * {@link BlockTextureTable.uniformData} to a uniform buffer.
 */
export class BlockTextureTable {
  private readonly maxBlocks: number;
  /** Flat Float32Array of length `maxBlocks * 3 * 4` (vec4 per face). */
  public readonly uniformData: Float32Array;

  public constructor(maxBlocks: number) {
    this.maxBlocks = maxBlocks;
    this.uniformData = new Float32Array(maxBlocks * FACES_PER_BLOCK * 4);
  }

  /** Total uniform size in bytes (must be a multiple of 16). */
  public get byteSize(): number {
    return this.uniformData.byteLength;
  }

  /**
   * Set the UV rect for a (blockId, face) pair. Pass a zero rect (or omit) to
   * clear the face back to the flat-color fallback.
   */
  public set(blockId: number, face: number, rect: UVRect | null): void {
    if (blockId < 0 || blockId >= this.maxBlocks) return;
    const base = (blockId * FACES_PER_BLOCK + face) * 4;
    if (rect === null) {
      this.uniformData[base] = 0;
      this.uniformData[base + 1] = 0;
      this.uniformData[base + 2] = 0;
      this.uniformData[base + 3] = 0;
    } else {
      this.uniformData[base] = rect.u0;
      this.uniformData[base + 1] = rect.v0;
      this.uniformData[base + 2] = rect.u1;
      this.uniformData[base + 3] = rect.v1;
    }
  }

  /** Get the UV rect for a (blockId, face), or null if unset (zero rect). */
  public get(blockId: number, face: number): UVRect | null {
    if (blockId < 0 || blockId >= this.maxBlocks) return null;
    const base = (blockId * FACES_PER_BLOCK + face) * 4;
    const u0 = this.uniformData[base]!;
    const v0 = this.uniformData[base + 1]!;
    const u1 = this.uniformData[base + 2]!;
    const v1 = this.uniformData[base + 3]!;
    if (u0 === 0 && v0 === 0 && u1 === 0 && v1 === 0) return null;
    return { u0, v0, u1, v1 };
  }

  /**
   * Resolve a {@link BlockFaceTextures} name mapping against a UV-lookup
   * function (e.g. `atlas.getUV.bind(atlas)`) and write all three faces.
   * Missing `top`/`bottom` fall back to `side`. Unknown names are skipped
   * (left as zero / flat-color fallback).
   *
   * @returns true if at least one face resolved to a texture.
   */
  public setFromNames(
    blockId: number,
    faces: BlockFaceTextures,
    resolve: (name: string) => UVRect | null,
  ): boolean {
    const side = faces.side !== undefined ? resolve(faces.side) : null;
    const top = faces.top !== undefined ? resolve(faces.top) : side;
    const bottom = faces.bottom !== undefined ? resolve(faces.bottom) : side;
    this.set(blockId, FACE_TOP, top);
    this.set(blockId, FACE_BOTTOM, bottom);
    this.set(blockId, FACE_SIDE, side);
    return top !== null || bottom !== null || side !== null;
  }
}
