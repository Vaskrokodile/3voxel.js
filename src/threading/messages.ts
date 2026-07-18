/**
 * messages.ts — typed worker message protocol (discriminated unions).
 *
 * WorkerInbound  = messages the worker RECEIVES (requests from main thread).
 * WorkerOutbound = messages the worker SENDES (results to main thread).
 *
 * All Uint8Array payloads are TRANSFERRED (not copied) — senders must pass the
 * underlying ArrayBuffer in the postMessage transfer list. See chunkWorker.ts
 * and WorkerPool.ts.
 */

import type { ChunkCoord } from '../core/types.js';

/** Mesh a chunk on a worker. Raw block data is transferred, not the Chunk class. */
export interface MeshRequest {
  readonly type: 'mesh';
  /** Correlation id; the matching MeshResult carries the same id. */
  readonly id: number;
  readonly chunkCoord: ChunkCoord;
  readonly worldOrigin: Readonly<{ x: number; y: number; z: number }>;
  /**
   * Packed block data: one entry per voxel (CHUNK_VOLUME entries). Each entry
   * is an index into `paletteIds` (a palette of BlockIds). This keeps the
   * transfer small for single-block-type chunks.
   */
  readonly blocks: Uint8Array;
  /** BlockIds referenced by `blocks` (the palette). */
  readonly paletteIds: Uint32Array;
  /**
   * Optional per-block descriptors so the worker can classify blocks without
   * importing the real registry. Both arrays are indexed by palette index
   * (length === paletteIds.length).
   *   - `blockFlags`: bitfield, bit 0 = solid, bit 1 = transparent, bit 2 = opaqueFaces.
   *   - `blockMeshType`: 0 = none, 1 = cube, 2 = cross.
   * When omitted the worker falls back to treating every non-AIR block as an
   * opaque cube (backward compatible).
   */
  readonly blockFlags?: Uint8Array | undefined;
  readonly blockMeshType?: Uint8Array | undefined;
  /**
   * Optional 1-voxel border shells of the 6 neighbor chunks so the worker can
   * cull faces between two solid chunks across chunk boundaries (seam
   * stitching). Packed as a single Uint32Array of length 6 * CHUNK_SIZE *
   * CHUNK_SIZE (6 * 256 = 1536 entries), ordered by direction:
   *   0 = -x, 1 = +x, 2 = -y, 3 = +y, 4 = -z, 5 = +z.
   * Each 256-entry face is the neighbor's voxels on the face touching this
   * chunk, indexed by (inPlaneA * CHUNK_SIZE + inPlaneB) where the in-plane
   * axes are the two axes other than the face normal:
   *   - x faces (+x/-x): a = ly, b = lz
   *   - y faces (+y/-y): a = lx, b = lz
   *   - z faces (+z/-z): a = lx, b = ly
   * Entries are raw BlockIds (Uint32). Unloaded neighbors should be filled
   * with AIR (0); the mesher then emits the edge face as before. When omitted
   * the worker treats all out-of-chunk neighbors as AIR (legacy behavior).
   */
  readonly neighborShells?: Uint32Array | undefined;
}

/** Result of meshing a chunk, returned from the worker. */
export interface MeshResult {
  readonly type: 'meshResult';
  readonly id: number;
  readonly chunk: ChunkCoord;
  readonly vertices: Uint8Array;
  readonly indices: Uint8Array;
  readonly indexFormat: 'uint16' | 'uint32';
  readonly vertexCount: number;
  readonly indexCount: number;
  readonly opaqueIndexCount: number;
  readonly transparentIndexCount: number;
  /**
   * Cross/plant billboard geometry (separate buffer). Always present; empty
   * (zero counts) when the chunk has no 'cross' meshType blocks. See
   * ChunkMeshDataEx in meshing/types.ts for the renderer/shader contract.
   */
  readonly crossVertices?: Uint8Array | undefined;
  readonly crossIndices?: Uint8Array | undefined;
  readonly crossIndexFormat?: 'uint16' | 'uint32' | undefined;
  readonly crossVertexCount?: number | undefined;
  readonly crossIndexCount?: number | undefined;
}

/** Generation request (forwarded to the generation module by the worker). */
export interface GenRequest {
  readonly type: 'gen';
  readonly id: number;
  readonly chunkCoord: ChunkCoord;
  readonly seed: number;
}

/** Messages the worker receives. */
export type WorkerInbound = MeshRequest | GenRequest;

/** Messages the worker sends. */
export type WorkerOutbound = MeshResult;
