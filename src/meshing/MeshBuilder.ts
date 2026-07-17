/**
 * MeshBuilder.ts — growable interleaved vertex + index buffer builder.
 *
 * Writes vertices in the layout documented in VertexLayout.ts via a DataView.
 * Index storage starts as uint16 and is automatically upgraded to uint32
 * (re-emitting all existing indices) the moment the vertex count exceeds
 * 65535, so the renderer always gets a consistent indexFormat.
 *
 * Opaque and transparent index counts are tracked separately; callers emit
 * opaque triangles first, then transparent ones, so the index buffer is laid
 * out opaque-first (matches ChunkMeshData.opaqueIndexCount /
 * transparentIndexCount).
 *
 * Growth strategy: doubling. No per-vertex allocations after construction.
 */

import { OFFSETS, VERTEX_STRIDE } from './VertexLayout.js';

export interface MeshBuilderBuildResult {
  readonly vertices: Uint8Array;
  readonly indices: Uint8Array;
  readonly indexFormat: 'uint16' | 'uint32';
  readonly vertexCount: number;
  readonly indexCount: number;
}

const INITIAL_VERTEX_BYTES = 4096 * VERTEX_STRIDE;
const INITIAL_INDEX_COUNT = 4096 * 6;
const U16_MAX = 65535;

export class MeshBuilder {
  private vertexBytes: Uint8Array;
  private view: DataView;
  private vertexCount = 0;

  private indexU16: Uint16Array;
  private indexU32: Uint32Array | null = null;
  private indexFormat: 'uint16' | 'uint32' = 'uint16';
  private indexCount = 0;

  private opaqueIndexCount = 0;
  private transparentIndexCount = 0;

  constructor() {
    this.vertexBytes = new Uint8Array(INITIAL_VERTEX_BYTES);
    this.view = new DataView(this.vertexBytes.buffer);
    this.indexU16 = new Uint16Array(INITIAL_INDEX_COUNT);
  }

  /** Number of vertices emitted so far. */
  getVertexCount(): number {
    return this.vertexCount;
  }

  /** Current index format (upgrades to uint32 once >65535 vertices). */
  getIndexFormat(): 'uint16' | 'uint32' {
    return this.indexFormat;
  }

  /**
   * Append one interleaved vertex. Returns its index (0-based).
   * `ao` is clamped to 0..3. `blockId` is written as uint16.
   */
  addVertex(
    pos: readonly [number, number, number],
    normal: readonly [number, number, number],
    ao: number,
    blockId: number,
    uv: readonly [number, number],
  ): number {
    const idx = this.vertexCount;
    const byteOffset = idx * VERTEX_STRIDE;
    this.ensureVertexCapacity(byteOffset + VERTEX_STRIDE);

    const v = this.view;
    v.setFloat32(byteOffset + OFFSETS.position, pos[0], true);
    v.setFloat32(byteOffset + OFFSETS.position + 4, pos[1], true);
    v.setFloat32(byteOffset + OFFSETS.position + 8, pos[2], true);
    v.setFloat32(byteOffset + OFFSETS.normal, normal[0], true);
    v.setFloat32(byteOffset + OFFSETS.normal + 4, normal[1], true);
    v.setFloat32(byteOffset + OFFSETS.normal + 8, normal[2], true);
    v.setUint8(byteOffset + OFFSETS.ao, ao < 0 ? 0 : ao > 3 ? 3 : ao);
    v.setUint16(byteOffset + OFFSETS.blockId, blockId, true);
    v.setFloat32(byteOffset + OFFSETS.uv, uv[0], true);
    v.setFloat32(byteOffset + OFFSETS.uv + 4, uv[1], true);

    this.vertexCount = idx + 1;

    // Auto-upgrade indices to uint32 once we can no longer address all
    // vertices with uint16. Re-emit existing indices into a uint32 buffer.
    if (this.vertexCount > U16_MAX && this.indexFormat === 'uint16') {
      this.upgradeIndicesToU32();
    }

    return idx;
  }

  /**
   * Append a triangle (three vertex indices). `transparent` selects which
   * bucket's count is incremented; the index itself is appended in order so
   * opaque triangles precede transparent ones (caller is responsible for
   * ordering).
   */
  addTriangle(a: number, b: number, c: number, transparent = false): void {
    this.ensureIndexCapacity(this.indexCount + 3);
    if (this.indexFormat === 'uint16') {
      this.indexU16[this.indexCount] = a;
      this.indexU16[this.indexCount + 1] = b;
      this.indexU16[this.indexCount + 2] = c;
    } else {
      const u32 = this.indexU32 as Uint32Array;
      u32[this.indexCount] = a;
      u32[this.indexCount + 1] = b;
      u32[this.indexCount + 2] = c;
    }
    this.indexCount += 3;
    if (transparent) {
      this.transparentIndexCount += 3;
    } else {
      this.opaqueIndexCount += 3;
    }
  }

  getOpaqueIndexCount(): number {
    return this.opaqueIndexCount;
  }

  getTransparentIndexCount(): number {
    return this.transparentIndexCount;
  }

  /**
   * Finalize: copy vertex and index data into exactly-sized Uint8Array views
   * (no slack). The returned buffers are detached from this builder.
   */
  build(): MeshBuilderBuildResult {
    const vertexBytes = new Uint8Array(this.vertexCount * VERTEX_STRIDE);
    vertexBytes.set(this.vertexBytes.subarray(0, vertexBytes.length));

    const bytesPerIndex = this.indexFormat === 'uint16' ? 2 : 4;
    const indexBytes = new Uint8Array(this.indexCount * bytesPerIndex);
    if (this.indexCount > 0) {
      if (this.indexFormat === 'uint16') {
        indexBytes.set(
          new Uint8Array(
            this.indexU16.buffer,
            this.indexU16.byteOffset,
            this.indexCount * 2,
          ),
        );
      } else {
        const u32 = this.indexU32 as Uint32Array;
        indexBytes.set(
          new Uint8Array(u32.buffer, u32.byteOffset, this.indexCount * 4),
        );
      }
    }

    return {
      vertices: vertexBytes,
      indices: indexBytes,
      indexFormat: this.indexFormat,
      vertexCount: this.vertexCount,
      indexCount: this.indexCount,
    };
  }

  private ensureVertexCapacity(requiredBytes: number): void {
    if (requiredBytes <= this.vertexBytes.length) return;
    let cap = this.vertexBytes.length;
    while (cap < requiredBytes) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.vertexBytes);
    this.vertexBytes = next;
    this.view = new DataView(this.vertexBytes.buffer);
  }

  private ensureIndexCapacity(required: number): void {
    if (this.indexFormat === 'uint16') {
      if (required <= this.indexU16.length) return;
      let cap = this.indexU16.length;
      while (cap < required) cap *= 2;
      const next = new Uint16Array(cap);
      next.set(this.indexU16);
      this.indexU16 = next;
    } else {
      const u32 = this.indexU32 as Uint32Array;
      if (required <= u32.length) return;
      let cap = u32.length;
      while (cap < required) cap *= 2;
      const next = new Uint32Array(cap);
      next.set(u32);
      this.indexU32 = next;
    }
  }

  private upgradeIndicesToU32(): void {
    const u32 = new Uint32Array(Math.max(this.indexU16.length, this.indexCount + 3));
    for (let i = 0; i < this.indexCount; i++) {
      u32[i] = this.indexU16[i] ?? 0;
    }
    this.indexU32 = u32;
    this.indexU16 = new Uint16Array(0);
    this.indexFormat = 'uint32';
  }
}
