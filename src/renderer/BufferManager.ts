/**
 * GPU buffer manager.
 *
 * Owns creation + upload of vertex/index/uniform buffers, tracks total
 * allocated bytes (for budgeting/diagnostics), and maintains a small pool of
 * uniform buffers at common sizes to reduce allocation churn during a frame.
 *
 * All buffers are created with `mappedAtCreation: false` and written via
 * `queue.writeBuffer`, which avoids the map/unmap round-trip and is the
 * recommended pattern for streaming per-frame data.
 */

import type { Logger } from '../core/types.js';
import { toGPUBufferSource } from './util.js';

/** Common uniform buffer sizes that are pooled (in bytes, must be multiples of 16). */
const POOLED_SIZES: readonly number[] = [64, 128, 192, 224, 256];

/** Round a byte size up to the next multiple of 16 (WebGPU uniform alignment). */
export function roundUp16(n: number): number {
  return (n + 15) & ~15;
}

/** Manages GPU buffer allocation, upload, and a uniform-buffer pool. */
export class BufferManager {
  private readonly device: GPUDevice;
  private readonly queue: GPUQueue;
  private readonly logger: Logger | undefined;
  private readonly pools = new Map<number, GPUBuffer[]>();
  private _bytesAllocated = 0;

  public constructor(device: GPUDevice, logger?: Logger) {
    this.device = device;
    this.queue = device.queue;
    this.logger = logger;
  }

  /** Total bytes currently allocated across all live buffers (incl. pooled). */
  public get bytesAllocated(): number {
    return this._bytesAllocated;
  }

  /**
   * Create a buffer and upload `data` into it.
   *
   * @param data Vertex/index bytes.
   * @param usage `GPUBufferUsage.VERTEX` / `INDEX` / etc.
   * @returns The uploaded buffer (unmapped).
   */
  public upload(data: Uint8Array, usage: GPUBufferUsageFlags): GPUBuffer {
    if (data.byteLength === 0) {
      // WebGPU requires non-zero size for createBuffer in some impls; create a
      // 1-byte buffer to stay safe but record the real requested size.
      const buf = this.device.createBuffer({ size: 4, usage });
      this._bytesAllocated += 4;
      return buf;
    }
    const size = roundUp16(data.byteLength);
    const buffer = this.device.createBuffer({ size, usage });
    this._bytesAllocated += size;
    this.queue.writeBuffer(buffer, 0, toGPUBufferSource(data), 0, data.byteLength);
    return buffer;
  }

  /**
   * Create a uniform buffer of exactly `size` bytes (rounded up to 16).
   * Tries the pool first for common sizes.
   */
  public createUniformBuffer(size: number): GPUBuffer {
    const rounded = roundUp16(size);
    const pooled = this.pools.get(rounded);
    if (pooled !== undefined && pooled.length > 0) {
      const buf = pooled.pop() as GPUBuffer;
      return buf;
    }
    const buffer = this.device.createBuffer({
      size: rounded,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this._bytesAllocated += rounded;
    return buffer;
  }

  /**
   * Write uniform data into `buffer` at `offset` (default 0).
   * `data` may be any `BufferSource` accepted by `writeBuffer`.
   */
  public writeUniform(
    buffer: GPUBuffer,
    data: BufferSource,
    offset = 0,
  ): void {
    this.queue.writeBuffer(buffer, offset, data);
  }

  /**
   * Return a uniform buffer to the pool for reuse, if its size is pooled.
   * Otherwise destroys it and decrements the accounting.
   */
  public releaseUniformBuffer(buffer: GPUBuffer): void {
    const size = roundUp16(buffer.size);
    if (POOLED_SIZES.includes(size)) {
      let pool = this.pools.get(size);
      if (pool === undefined) {
        pool = [];
        this.pools.set(size, pool);
      }
      pool.push(buffer);
      return;
    }
    this.destroy(buffer);
  }

  /** Destroy a buffer and subtract its size from the accounting. */
  public destroy(buffer: GPUBuffer): void {
    const size = roundUp16(buffer.size);
    buffer.destroy();
    this._bytesAllocated -= size;
    if (this._bytesAllocated < 0) {
      // Defensive: should never happen, but keep the counter sane.
      this.logger?.log('warn', 'bytesAllocated went negative; clamping.', { size });
      this._bytesAllocated = 0;
    }
  }

  /** Destroy all pooled buffers and reset accounting. */
  public dispose(): void {
    for (const pool of this.pools.values()) {
      for (const buf of pool) {
        this._bytesAllocated -= roundUp16(buf.size);
        buf.destroy();
      }
    }
    this.pools.clear();
    if (this._bytesAllocated < 0) this._bytesAllocated = 0;
  }
}

export { POOLED_SIZES };
