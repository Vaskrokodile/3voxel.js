/**
 * Day/night cycle time management.
 *
 * Tracks the current in-game time (in [0, 24) hours) and advances it each frame
 * based on a configurable time scale. Exposes convenience accessors for
 * lighting calculations (`dayFactor`, `isDay`).
 */

/** Default time scale: 0.5 in-game hours per real second (48 min real-time per day). */
const DEFAULT_TIME_SCALE = 0.5;
/** Hours in a day. */
const HOURS_PER_DAY = 24;

/**
 * Manages a continuous 24-hour day/night cycle.
 *
 * - `timeOfDay` 6 = sunrise, 12 = noon, 18 = sunset, 0/24 = midnight.
 * - `dayFactor` is 0 at midnight, 1 at noon — useful for smooth lighting blends.
 * - `isDay` is true when the sun is above the horizon (time in [6, 18)).
 */
export class DayNightCycle {
  /** Current time in [0, 24) hours. */
  private time: number;
  /** In-game hours per real second. */
  private readonly timeScale: number;

  /**
   * @param startTime Initial time of day in [0, 24). Defaults to 8 (morning).
   * @param timeScale In-game hours per real second. Defaults to 0.5.
   */
  public constructor(startTime = 8, timeScale = DEFAULT_TIME_SCALE) {
    this.time = wrapTime(startTime);
    this.timeScale = timeScale;
  }

  /**
   * Advance the clock by `dt` real seconds.
   * Time wraps around at 24 hours.
   */
  public update(dt: number): void {
    this.time = wrapTime(this.time + dt * this.timeScale);
  }

  /** Current time of day in [0, 24) hours. */
  public get currentTime(): number {
    return this.time;
  }

  /**
   * Day factor in [0, 1]: 0 at midnight, 1 at noon.
   *
   * Uses a smooth curve based on the sun's height:
   *   `dayFactor = clamp(sin((time - 6) * PI / 12), 0, 1)`
   * This is 0 at sunrise/sunset (6/18) and 1 at noon (12), with smooth
   * transitions — no popping.
   */
  public get dayFactor(): number {
    const angle = (this.time - 6) * Math.PI / 12;
    const f = Math.sin(angle);
    if (f < 0) return 0;
    if (f > 1) return 1;
    return f;
  }

  /** True when the sun is above the horizon (time in [6, 18)). */
  public get isDay(): boolean {
    return this.time >= 6 && this.time < 18;
  }
}

/** Wrap a time value into [0, 24). */
function wrapTime(t: number): number {
  const wrapped = t % HOURS_PER_DAY;
  if (wrapped < 0) return wrapped + HOURS_PER_DAY;
  return wrapped;
}
