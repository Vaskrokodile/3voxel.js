/**
 * Day/night cycle time management.
 *
 * Tracks the current in-game time (in [0, 24) hours) and advances it each frame
 * based on a configurable time scale. Exposes convenience accessors for
 * lighting calculations (`dayFactor`, `isDay`).
 */

import type { Vec3 } from '../core/types.js';

/** Default time scale: 0.5 in-game hours per real second (48 min real-time per day). */
const DEFAULT_TIME_SCALE = 0.5;
/** Default day length in real seconds for {@link DayNightCycle.advance}. */
const DEFAULT_DAY_LENGTH = 120;
/** Hours in a day. */
const HOURS_PER_DAY = 24;

/**
 * Manages a continuous 24-hour day/night cycle.
 *
 * - `timeOfDay` 6 = sunrise, 12 = noon, 18 = sunset, 0/24 = midnight.
 * - `dayFactor` is 0 at midnight, 1 at noon — useful for smooth lighting blends.
 * - `isDay` is true when the sun is above the horizon (time in [6, 18)).
 *
 * The normalized {@link timeOfDay} in [0, 1) maps 0 = midnight, 0.25 = sunrise,
 * 0.5 = noon, 0.75 = sunset. {@link sunDirection} is derived from it so the
 * sky / atmosphere shaders can be driven directly.
 */
export class DayNightCycle {
  /** Current time in [0, 24) hours. */
  private time: number;
  /** In-game hours per real second (used by {@link update}). */
  private readonly timeScale: number;
  /** Real seconds for a full 24-hour cycle (used by {@link advance}). */
  private readonly dayLengthSeconds: number;

  /**
   * @param startTime        Initial time of day in [0, 24). Defaults to 8 (morning).
   * @param timeScale        In-game hours per real second (used by {@link update}).
   *                         Defaults to 0.5.
   * @param dayLengthSeconds Real seconds per full day/night cycle (used by
   *                         {@link advance}). Defaults to 120 (2 min per day).
   */
  public constructor(startTime = 8, timeScale = DEFAULT_TIME_SCALE, dayLengthSeconds = DEFAULT_DAY_LENGTH) {
    this.time = wrapTime(startTime);
    this.timeScale = timeScale;
    this.dayLengthSeconds = dayLengthSeconds;
  }

  /**
   * Advance the clock by `dt` real seconds using `timeScale`.
   * Time wraps around at 24 hours.
   */
  public update(dt: number): void {
    this.time = wrapTime(this.time + dt * this.timeScale);
  }

  /**
   * Advance the clock by `dt` real seconds using `dayLengthSeconds`.
   *
   * One full cycle (24 in-game hours) takes exactly `dayLengthSeconds` real
   * seconds, regardless of `timeScale`. Time wraps around at 24 hours.
   */
  public advance(dt: number): void {
    const hoursPerSecond = HOURS_PER_DAY / this.dayLengthSeconds;
    this.time = wrapTime(this.time + dt * hoursPerSecond);
  }

  /** Current time of day in [0, 24) hours. */
  public get currentTime(): number {
    return this.time;
  }

  /** Normalized time of day in [0, 1): 0 = midnight, 0.25 = sunrise, 0.5 = noon, 0.75 = sunset. */
  public get timeOfDay(): number {
    return this.time / HOURS_PER_DAY;
  }

  /** Set the clock from a normalized time of day in [0, 1). */
  public setTimeOfDay(t: number): void {
    this.time = wrapTime(t * HOURS_PER_DAY);
  }

  /**
   * Normalized sun direction (points toward the sun) derived from the current
   * time of day. At noon (0.5) it points straight up; at sunrise (0.25) it
   * points east along the horizon; at sunset (0.75) west; at midnight (0) down.
   */
  public get sunDirection(): Vec3 {
    return DayNightCycle.sunDirectionForTimeOfDay(this.timeOfDay);
  }

  /**
   * Compute a normalized sun direction for a normalized time of day.
   *
   * @param timeOfDay Normalized [0, 1) time of day.
   * @returns Unit vector pointing toward the sun.
   */
  public static sunDirectionForTimeOfDay(timeOfDay: number): Vec3 {
    const angle = (timeOfDay - 0.25) * Math.PI * 2;
    const raw: Vec3 = { x: Math.cos(angle), y: Math.sin(angle), z: 0.3 };
    const len = Math.hypot(raw.x, raw.y, raw.z);
    return { x: raw.x / len, y: raw.y / len, z: raw.z / len };
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
