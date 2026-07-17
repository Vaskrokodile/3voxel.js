/**
 * Meshing subsystem — local type contracts.
 *
 * These mirror the voxel module's public interfaces (built in parallel).
 * We define them locally so the mesher type-checks without importing the
 * voxel module, which may not exist yet. At runtime the real voxel classes
 * are structurally compatible.
 */

import type { BlockId, ChunkCoord } from '../core/types.js';

/**
 * Minimal read-only view of a voxel chunk the mesher needs.
 * Local coordinates are in [0, CHUNK_SIZE).
 */
export interface VoxelChunkLike {
  readonly coord: ChunkCoord;
  getBlock(lx: number, ly: number, lz: number): BlockId;
  /**
   * Optional fast check: true when the chunk contains only AIR. When present
   * and true, the mesher skips meshing entirely (early exit). Implementations
   * backed by a palette can answer this in O(1).
   */
  isEmpty?: () => boolean;
}

/** Block definition shape consumed by the mesher. */
export interface BlockTypeLike {
  readonly id: BlockId;
  readonly name: string;
  /** Whether the block has collision / is considered solid for face ownership. */
  readonly solid: boolean;
  /** Transparent blocks (water, glass) go into the transparent index bucket. */
  readonly transparent: boolean;
  /** If true, this block fully occludes adjacent faces (no face drawn against it). */
  readonly opaqueFaces: boolean;
  /** Geometry class. Only 'cube' is meshed here; 'cross' is a future stub. */
  readonly meshType: 'cube' | 'cross' | 'none';
}

/** Registry mapping BlockId -> BlockTypeLike. */
export interface BlockRegistryLike {
  get(id: BlockId): BlockTypeLike | undefined;
}

/**
 * World-space neighbor sampler. Given absolute world voxel coordinates,
 * returns the BlockId at that position. Used to cull faces between chunk
 * boundaries. The mesher receives the chunk's world origin so it can call
 * this with absolute coords for edge voxels.
 */
export type NeighborSampler = (wx: number, wy: number, wz: number) => BlockId;

/**
 * Vertex layout descriptor for a single interleaved attribute.
 */
export interface VertexAttribute {
  /** Shader location / attribute name. */
  readonly name: string;
  /** WebGPU vertex format string. */
  readonly format: 'float32x3' | 'float32x2' | 'uint8' | 'uint16';
  /** Byte offset from the start of the vertex. */
  readonly offset: number;
}

/**
 * Documented interleaved vertex layout (see VertexLayout.ts for byte map).
 * Kept here as a constant descriptor array so the renderer can build its
 * GPVertexBufferLayout without hardcoding offsets.
 */
export const VERTEX_LAYOUT: readonly VertexAttribute[] = [
  { name: 'position', format: 'float32x3', offset: 0 },
  { name: 'normal', format: 'float32x3', offset: 12 },
  { name: 'ao', format: 'uint8', offset: 24 },
  { name: 'blockId', format: 'uint16', offset: 26 },
  { name: 'uv', format: 'float32x2', offset: 28 },
] as const;
