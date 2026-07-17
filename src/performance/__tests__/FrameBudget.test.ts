import { describe, expect, it } from 'vitest';
import { FrameBudget } from '../FrameBudget.js';

function makeBudget(overrides: Partial<{
  targetFps: number;
  minViewDistance: number;
  maxViewDistance: number;
  minMaxPerFrame: number;
  maxMaxPerFrame: number;
  historySize: number;
  hysteresisSeconds: number;
}> = {}): FrameBudget {
  return new FrameBudget({
    targetFps: overrides.targetFps ?? 60,
    minViewDistance: overrides.minViewDistance ?? 4,
    maxViewDistance: overrides.maxViewDistance ?? 16,
    minMaxPerFrame: overrides.minMaxPerFrame ?? 1,
    maxMaxPerFrame: overrides.maxMaxPerFrame ?? 8,
    historySize: overrides.historySize ?? 30,
    hysteresisSeconds: overrides.hysteresisSeconds ?? 2,
  });
}

describe('FrameBudget', () => {
  it('starts at the minimum view distance', () => {
    const fb = makeBudget({ minViewDistance: 4, maxViewDistance: 16 });
    expect(fb.recommendedViewDistance).toBe(4);
  });

  it('increases view distance when frames are fast enough', () => {
    const fb = makeBudget({
      minViewDistance: 4,
      maxViewDistance: 16,
      historySize: 10,
      hysteresisSeconds: 0,
    });
    // 120 FPS -> well above target*0.95 (57). Should ramp up.
    for (let i = 0; i < 20; i++) fb.recordFrame(1 / 120);
    expect(fb.recommendedViewDistance).toBeGreaterThan(4);
    expect(fb.avgFps).toBeGreaterThan(100);
    expect(fb.isThrottled).toBe(false);
  });

  it('decreases view distance when frames are too slow', () => {
    const fb = makeBudget({
      minViewDistance: 4,
      maxViewDistance: 16,
      historySize: 10,
      hysteresisSeconds: 0,
    });
    // Start high by recording fast frames.
    for (let i = 0; i < 40; i++) fb.recordFrame(1 / 120);
    const high = fb.recommendedViewDistance;
    expect(high).toBeGreaterThan(4);
    // Now choke: 20 FPS -> below target*0.9 (54).
    for (let i = 0; i < 40; i++) fb.recordFrame(1 / 20);
    expect(fb.recommendedViewDistance).toBeLessThan(high);
    expect(fb.isThrottled).toBe(true);
  });

  it('clamps view distance to the configured max', () => {
    const fb = makeBudget({
      minViewDistance: 4,
      maxViewDistance: 6,
      historySize: 5,
      hysteresisSeconds: 0,
    });
    for (let i = 0; i < 200; i++) fb.recordFrame(1 / 120);
    expect(fb.recommendedViewDistance).toBeLessThanOrEqual(6);
  });

  it('clamps view distance to the configured min', () => {
    const fb = makeBudget({
      minViewDistance: 4,
      maxViewDistance: 16,
      historySize: 5,
      hysteresisSeconds: 0,
    });
    for (let i = 0; i < 200; i++) fb.recordFrame(1 / 10);
    expect(fb.recommendedViewDistance).toBeGreaterThanOrEqual(4);
  });

  it('applies hysteresis: does not change more than once per hysteresis window', () => {
    const fb = makeBudget({
      minViewDistance: 4,
      maxViewDistance: 16,
      historySize: 5,
      hysteresisSeconds: 0.5,
    });
    // Record a few fast frames; total elapsed < 0.5s so no change yet.
    for (let i = 0; i < 5; i++) fb.recordFrame(1 / 120);
    expect(fb.recommendedViewDistance).toBe(4);
    // Keep recording fast frames past the 0.5s hysteresis window.
    // 120 frames at 1/120s = 1.0s elapsed > 0.5s window.
    for (let i = 0; i < 120; i++) fb.recordFrame(1 / 120);
    expect(fb.recommendedViewDistance).toBeGreaterThan(4);
  });

  it('scales maxPerFrame between min and max based on performance', () => {
    const fb = makeBudget({
      minMaxPerFrame: 1,
      maxMaxPerFrame: 8,
      historySize: 10,
      hysteresisSeconds: 0,
    });
    // Fast frames -> maxPerFrame near max.
    for (let i = 0; i < 20; i++) fb.recordFrame(1 / 120);
    expect(fb.recommendedMaxPerFrame).toBeGreaterThanOrEqual(7);
    // Slow frames -> maxPerFrame at min.
    for (let i = 0; i < 40; i++) fb.recordFrame(1 / 20);
    expect(fb.recommendedMaxPerFrame).toBe(1);
  });

  it('avgFps reflects the rolling window', () => {
    const fb = makeBudget({ historySize: 10, hysteresisSeconds: 0 });
    for (let i = 0; i < 10; i++) fb.recordFrame(1 / 60);
    expect(fb.avgFps).toBeCloseTo(60, 0);
  });
});
