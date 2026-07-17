import { describe, it, expect } from 'vitest';
import { DayNightCycle } from '../DayNightCycle.js';

describe('DayNightCycle.update', () => {
  it('advances time by timeScale * dt', () => {
    const cycle = new DayNightCycle(0, 0.5);
    cycle.update(1.0);
    expect(cycle.currentTime).toBeCloseTo(0.5);
  });

  it('wraps around at 24 hours', () => {
    const cycle = new DayNightCycle(23.5, 1.0);
    cycle.update(1.0);
    expect(cycle.currentTime).toBeCloseTo(0.5);
  });

  it('wraps correctly when crossing midnight with fractional scale', () => {
    const cycle = new DayNightCycle(23.75, 0.5);
    cycle.update(1.0);
    expect(cycle.currentTime).toBeCloseTo(0.25);
  });
});

describe('DayNightCycle.dayFactor', () => {
  it('is 1 at noon', () => {
    const cycle = new DayNightCycle(12, 0.5);
    expect(cycle.dayFactor).toBeCloseTo(1);
  });

  it('is 0 at midnight', () => {
    const cycle = new DayNightCycle(0, 0.5);
    expect(cycle.dayFactor).toBeCloseTo(0);
  });

  it('is 0 at sunrise (6) and sunset (18)', () => {
    const cycle6 = new DayNightCycle(6, 0.5);
    expect(cycle6.dayFactor).toBeCloseTo(0, 5);
    const cycle18 = new DayNightCycle(18, 0.5);
    expect(cycle18.dayFactor).toBeCloseTo(0, 5);
  });

  it('is between 0 and 1 during morning', () => {
    const cycle = new DayNightCycle(9, 0.5);
    const f = cycle.dayFactor;
    expect(f).toBeGreaterThan(0);
    expect(f).toBeLessThan(1);
  });
});

describe('DayNightCycle.isDay', () => {
  it('is true at noon', () => {
    const cycle = new DayNightCycle(12, 0.5);
    expect(cycle.isDay).toBe(true);
  });

  it('is false at midnight', () => {
    const cycle = new DayNightCycle(0, 0.5);
    expect(cycle.isDay).toBe(false);
  });

  it('is true at sunrise (6) and false at sunset (18)', () => {
    const cycle6 = new DayNightCycle(6, 0.5);
    expect(cycle6.isDay).toBe(true);
    const cycle18 = new DayNightCycle(18, 0.5);
    expect(cycle18.isDay).toBe(false);
  });
});
