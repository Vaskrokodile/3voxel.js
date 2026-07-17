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
