/**
 * Shared core types for tdjs.
 *
 * These are the ONLY cross-module contracts. Each subsystem owns its own
 * internal types. Subagents must not invent parallel definitions of these.
 */

/** Signed 32-bit integer voxel coordinate within a chunk (0..CHUNK_SIZE-1). */
export type LocalCoord = number;

/** World-space chunk coordinate. May be negative. */
export interface ChunkCoord {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Floating-point world position. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** 4x4 column-major matrix (WebGPU convention). */
export interface Mat4 {
  /** 16 floats, column-major. */
  readonly m: Float32Array;
}

/** Axis-aligned bounding box in world space. */
export interface AABB {
  readonly min: Vec3;
  readonly max: Vec3;
}

/**
 * Block identifier. 0 is reserved for AIR. Implementations may use a palette
 * so the on-chunk storage is compact (e.g. 8-bit index into a per-chunk
 * palette of BlockIds).
 */
export type BlockId = number;

export const AIR: BlockId = 0;

/** Chunk edge length in voxels. Must be a power of two. 16 is the default. */
export const CHUNK_SIZE = 16;
export const CHUNK_VOLUME = CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE;

/** Key for chunk maps: encodes (x,y,z) into a string. */
export function chunkKey(c: ChunkCoord): string {
  return `${c.x},${c.y},${c.z}`;
}

/** Result of meshing a single chunk. Raw CPU-side data; the renderer uploads it. */
export interface ChunkMeshData {
  readonly chunk: ChunkCoord;
  /** Interleaved vertex bytes (position, normal, ao, uv, blockId...). Layout owned by mesher. */
  readonly vertices: Uint8Array;
  /** Index bytes (uint16 or uint32, decided by mesher based on vertex count). */
  readonly indices: Uint8Array;
  /** True when indices are uint32; false for uint16. */
  readonly indexFormat: 'uint16' | 'uint32';
  /** Number of vertices. */
  readonly vertexCount: number;
  /** Number of indices. */
  readonly indexCount: number;
  /** Separate pass for transparent (e.g. water/glass) faces. */
  readonly transparentIndexCount: number;
  /** Opaque index count (indices are laid out opaque-first, then transparent). */
  readonly opaqueIndexCount: number;
}

/** Severity for the engine's internal diagnostics. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Minimal logger interface to avoid pulling a dep. */
export interface Logger {
  log(level: LogLevel, msg: string, ctx?: Record<string, unknown>): void;
}
