/**
 * FrameBudget.ts — adaptive performance scaling.
 *
 * Monitors frame times in a rolling window and recommends a view distance
 * and per-frame meshing budget that keep the engine near a target FPS.
 *
 * Algorithm:
 *   - Keep a rolling window of frame deltas (seconds).
 *   - Average FPS = historySize / sum(history).
 *   - If avgFps < target * 0.9 for long enough (hysteresis: at least
 *     `hysteresisSeconds` since the last change), decrease view distance by 1.
 *   - If avgFps > target * 0.95, increase view distance by 1 (same hysteresis).
 *   - `maxPerFrame` scales linearly between minMaxPerFrame and maxMaxPerFrame
 *     based on how close avgFps is to target.
 *
 * `recordFrame` is a hot path: it only writes into a preallocated ring buffer
 * (no allocations).
 */

/** Options for {@link FrameBudget}. */
export interface FrameBudgetOptions {
  /** Target FPS (default 60). */
  readonly targetFps: number;
  /** Minimum recommended view distance (default 4). */
  readonly minViewDistance: number;
  /** Maximum recommended view distance (default 16). */
  readonly maxViewDistance: number;
  /** Minimum recommended chunks to mesh per frame (default 1). */
  readonly minMaxPerFrame: number;
  /** Maximum recommended chunks to mesh per frame (default 8). */
  readonly maxMaxPerFrame: number;
  /** Rolling window length in frames (default 30). */
  readonly historySize?: number;
  /** Minimum seconds between view-distance adjustments (default 2). */
  readonly hysteresisSeconds?: number;
}

const DEFAULT_HISTORY = 30;
const DEFAULT_HYSTERESIS = 2;

/**
 * Adaptive frame-time monitor that recommends a view distance and meshing
 * budget. Stateless across frames except for the rolling history and the
 * last adjustment timestamp.
 */
export class FrameBudget {
  private readonly targetFps: number;
  private readonly minViewDistance: number;
  private readonly maxViewDistance: number;
  private readonly minMaxPerFrame: number;
  private readonly maxMaxPerFrame: number;
  private readonly hysteresisSeconds: number;

  /** Ring buffer of frame deltas (seconds). Preallocated once. */
  private readonly frameTimes: Float64Array;
  private head = 0;
  private count = 0;

  /** Accumulated wall-clock time since start (seconds). */
  private elapsed = 0;
  /** Elapsed time (seconds) at the last view-distance adjustment. */
  private lastAdjustTime = 0;

  /** Current recommended view distance (starts at min). */
  private viewDistance: number;
  /** Current recommended max chunks per frame (starts at min). */
  private maxPerFrame: number;

  constructor(opts: FrameBudgetOptions) {
    this.targetFps = opts.targetFps;
    this.minViewDistance = opts.minViewDistance;
    this.maxViewDistance = opts.maxViewDistance;
    this.minMaxPerFrame = opts.minMaxPerFrame;
    this.maxMaxPerFrame = opts.maxMaxPerFrame;
    this.hysteresisSeconds = opts.hysteresisSeconds ?? DEFAULT_HYSTERESIS;
    const size = opts.historySize ?? DEFAULT_HISTORY;
    this.frameTimes = new Float64Array(size);
    this.viewDistance = opts.minViewDistance;
    this.maxPerFrame = opts.minMaxPerFrame;
  }

  /**
   * Record a frame's delta time. Call every frame.
   *
   * Hot path: writes one slot in a preallocated ring buffer and bumps a
   * counter. No allocations.
   *
   * @param dt Delta time in seconds since the previous frame.
   */
  recordFrame(dt: number): void {
    const size = this.frameTimes.length;
    this.frameTimes[this.head] = dt;
    this.head = (this.head + 1) % size;
    if (this.count < size) this.count++;
    this.elapsed += dt;
    this.recompute();
  }

  /**
   * Recompute the recommended view distance and meshing budget from the
   * current history. Applies hysteresis so adjustments happen at most once
   * per `hysteresisSeconds`.
   */
  private recompute(): void {
    if (this.count === 0) return;
    const avgFps = this.avgFps;
    const target = this.targetFps;
    const canAdjust = this.elapsed - this.lastAdjustTime >= this.hysteresisSeconds;

    if (canAdjust) {
      if (avgFps < target * 0.9 && this.viewDistance > this.minViewDistance) {
        this.viewDistance = this.viewDistance - 1;
        this.lastAdjustTime = this.elapsed;
      } else if (avgFps > target * 0.95 && this.viewDistance < this.maxViewDistance) {
        this.viewDistance = this.viewDistance + 1;
        this.lastAdjustTime = this.elapsed;
      }
    }

    // Scale maxPerFrame linearly: at target FPS use max, below target*0.9
    // use min, interpolate between.
    const ratio = (avgFps - this.targetFps * 0.9) / (this.targetFps * 0.1);
    const clamped = ratio < 0 ? 0 : ratio > 1 ? 1 : ratio;
    const span = this.maxMaxPerFrame - this.minMaxPerFrame;
    this.maxPerFrame = Math.round(this.minMaxPerFrame + span * clamped);
  }

  /** Recommended view distance (chunks), clamped to [min, max]. */
  get recommendedViewDistance(): number {
    return this.viewDistance;
  }

  /** Recommended max chunks to mesh per frame, clamped to [min, max]. */
  get recommendedMaxPerFrame(): number {
    return this.maxPerFrame;
  }

  /** Current average FPS over the rolling window. */
  get avgFps(): number {
    if (this.count === 0) return this.targetFps;
    let sum = 0;
    for (let i = 0; i < this.count; i++) {
      sum += this.frameTimes[i]!;
    }
    if (sum <= 0) return this.targetFps;
    return this.count / sum;
  }

  /** Whether the engine is currently throttled (avgFps below target * 0.9). */
  get isThrottled(): boolean {
    return this.avgFps < this.targetFps * 0.9;
  }
}
