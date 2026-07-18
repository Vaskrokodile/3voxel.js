/**
 * Meshing subsystem — local type contracts.
 *
 * These mirror the voxel module's public interfaces (built in parallel).
 * We define them locally so the mesher type-checks without importing the
 * voxel module, which may not exist yet. At runtime the real voxel classes
 * are structurally compatible.
 */

import type { BlockId, ChunkCoord, ChunkMeshData } from '../core/types.js';

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
  /** Geometry class. 'cube' is greedy-meshed; 'cross' emits billboard quads; 'none' is not meshed. */
  readonly meshType: 'cube' | 'cross' | 'none';
}

/** Registry mapping BlockId -> BlockTypeLike. */
export interface BlockRegistryLike {
  get(id: BlockId): BlockTypeLike | undefined;
}

/**
 * Compact per-block descriptor carried through the worker protocol so the
 * off-main-thread mesher can classify blocks (solid / transparent / opaque /
 * cross) without importing the real registry. Packed into typed arrays in the
 * MeshRequest (see threading/messages.ts).
 */
export interface BlockDescriptor {
  readonly solid: boolean;
  readonly transparent: boolean;
  readonly opaqueFaces: boolean;
  readonly meshType: 'none' | 'cube' | 'cross';
}

/**
 * Extended chunk mesh data. Adds a separate buffer for 'cross' meshType
 * blocks (plants/vegetation): two diagonal billboard quads per voxel, rendered
 * double-sided with alpha-tested textures.
 *
 * Opaque and transparent 'cube' geometry remains in the inherited
 * `vertices`/`indices` buffer, split by `opaqueIndexCount` /
 * `transparentIndexCount` (indices laid out opaque-first, then transparent) so
 * the renderer can draw the transparent index range with a blended material.
 *
 * Cross geometry lives in its own buffer (`crossVertices`/`crossIndices`) so it
 * can be drawn with a dedicated alpha-tested, double-sided material.
 *
 * SHADER / RENDERER CONTRACT (cross buffer):
 *   - Vertex layout is identical to the cube buffer (see VertexLayout.ts):
 *     position(float32x3), normal(float32x3), ao(uint8), blockId(uint16),
 *     uv(float32x2). The renderer should use the same vertex buffer layout.
 *   - The material drawing the cross buffer MUST disable back-face culling
 *     (cullMode: 'none') because the billboards are viewed from both sides.
 *   - The material MUST apply alpha testing (discard fragments with
 *     texture alpha < a threshold, e.g. 0.5) so the quad outline is masked
 *     out by the plant texture's alpha channel. No blending is required.
 *   - `blockId` indexes the same per-block texture array as cube geometry;
 *     the renderer should look up the plant texture by the cross block's id.
 *   - UVs are in [0,1] per quad (one full texture tile per diagonal quad).
 */
export interface ChunkMeshDataEx extends ChunkMeshData {
  /** Cross/plant billboard vertex bytes (same layout as `vertices`). */
  readonly crossVertices: Uint8Array;
  /** Cross/plant billboard index bytes (uint16 or uint32). */
  readonly crossIndices: Uint8Array;
  readonly crossIndexFormat: 'uint16' | 'uint32';
  readonly crossVertexCount: number;
  readonly crossIndexCount: number;
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
