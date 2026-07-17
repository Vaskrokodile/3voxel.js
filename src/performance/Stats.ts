/**
 * Stats.ts — rolling performance statistics tracker.
 *
 * Records a {@link PerfStats} snapshot each frame into a fixed-size ring
 * buffer and exposes averaged + latest views plus a HUD-formatted string.
 *
 * `record` is the only hot path; it writes into a preallocated array of
 * objects (mutated in place) so no allocations occur after construction.
 */

/** A single frame's performance snapshot. */
export interface PerfStats {
  /** Current frames-per-second. */
  readonly fps: number;
  /** Frame time in milliseconds. */
  readonly frameTime: number;
  /** Number of loaded chunks. */
  readonly chunkCount: number;
  /** Number of chunks with a ready mesh. */
  readonly meshedChunks: number;
  /** Number of draw calls this frame. */
  readonly drawCalls: number;
  /** Number of triangles emitted this frame. */
  readonly triangles: number;
  /** Estimated GPU time in milliseconds (0 if unavailable). */
  readonly gpuTimeEstimate: number;
  /** Estimated GPU memory in bytes (sum of buffer sizes). */
  readonly memoryEstimate: number;
}

/** Default rolling window length. */
const DEFAULT_HISTORY = 60;

/**
 * Mutable mirror of {@link PerfStats} used for the preallocated ring slots.
 * `record` mutates these in place to avoid per-frame allocations.
 */
interface MutablePerfStats {
  fps: number;
  frameTime: number;
  chunkCount: number;
  meshedChunks: number;
  drawCalls: number;
  triangles: number;
  gpuTimeEstimate: number;
  memoryEstimate: number;
}

/**
 * Rolling statistics tracker. Preallocates `historySize` mutable slots and
 * overwrites them in a ring, so steady-state recording is allocation-free.
 */
export class Stats {
  private readonly history: MutablePerfStats[];
  private readonly size: number;
  private head = 0;
  private count = 0;

  /**
   * @param historySize Number of frames to average over (default 60).
   */
  constructor(historySize: number = DEFAULT_HISTORY) {
    this.size = historySize;
    // Preallocate mutable slots so record() never allocates.
    this.history = new Array<MutablePerfStats>(historySize);
    for (let i = 0; i < historySize; i++) {
      this.history[i] = {
        fps: 0,
        frameTime: 0,
        chunkCount: 0,
        meshedChunks: 0,
        drawCalls: 0,
        triangles: 0,
        gpuTimeEstimate: 0,
        memoryEstimate: 0,
      };
    }
  }

  /**
   * Record a frame's stats. Copies the values into the next ring slot.
   *
   * Hot path: no allocations (slots are preallocated and mutated in place).
   */
  record(stats: PerfStats): void {
    const slot = this.history[this.head]!;
    // Mutate in place to avoid allocating a new object.
    slot.fps = stats.fps;
    slot.frameTime = stats.frameTime;
    slot.chunkCount = stats.chunkCount;
    slot.meshedChunks = stats.meshedChunks;
    slot.drawCalls = stats.drawCalls;
    slot.triangles = stats.triangles;
    slot.gpuTimeEstimate = stats.gpuTimeEstimate;
    slot.memoryEstimate = stats.memoryEstimate;
    this.head = (this.head + 1) % this.size;
    if (this.count < this.size) this.count++;
  }

  /**
   * Average of every numeric field over the recorded history. Returns zeros
   * if nothing has been recorded yet.
   */
  getAverage(): PerfStats {
    if (this.count === 0) {
      return {
        fps: 0,
        frameTime: 0,
        chunkCount: 0,
        meshedChunks: 0,
        drawCalls: 0,
        triangles: 0,
        gpuTimeEstimate: 0,
        memoryEstimate: 0,
      };
    }
    let fps = 0;
    let frameTime = 0;
    let chunkCount = 0;
    let meshedChunks = 0;
    let drawCalls = 0;
    let triangles = 0;
    let gpuTime = 0;
    let mem = 0;
    for (let i = 0; i < this.count; i++) {
      const s = this.history[i]!;
      fps += s.fps;
      frameTime += s.frameTime;
      chunkCount += s.chunkCount;
      meshedChunks += s.meshedChunks;
      drawCalls += s.drawCalls;
      triangles += s.triangles;
      gpuTime += s.gpuTimeEstimate;
      mem += s.memoryEstimate;
    }
    const n = this.count;
    return {
      fps: fps / n,
      frameTime: frameTime / n,
      chunkCount: chunkCount / n,
      meshedChunks: meshedChunks / n,
      drawCalls: drawCalls / n,
      triangles: triangles / n,
      gpuTimeEstimate: gpuTime / n,
      memoryEstimate: mem / n,
    };
  }

  /** The most recently recorded snapshot, or `null` if none. */
  getLatest(): PerfStats | null {
    if (this.count === 0) return null;
    const idx = (this.head - 1 + this.size) % this.size;
    return this.history[idx]!;
  }

  /**
   * Format the averaged stats as a multi-line string for HUD overlay.
   * Memory is shown in MiB; triangle count in thousands.
   */
  format(): string {
    const a = this.getAverage();
    const memMiB = a.memoryEstimate / (1024 * 1024);
    const triK = a.triangles / 1000;
    return [
      `fps:        ${a.fps.toFixed(1)}`,
      `frame:      ${a.frameTime.toFixed(2)} ms`,
      `chunks:     ${a.chunkCount.toFixed(0)} (${a.meshedChunks.toFixed(0)} meshed)`,
      `draws:      ${a.drawCalls.toFixed(0)}`,
      `tris:       ${triK.toFixed(1)}k`,
      `gpu:        ${a.gpuTimeEstimate.toFixed(2)} ms`,
      `mem:        ${memMiB.toFixed(1)} MiB`,
    ].join('\n');
  }
}
