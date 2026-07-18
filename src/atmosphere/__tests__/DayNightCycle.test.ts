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

describe('DayNightCycle.timeOfDay', () => {
  it('maps 0 hours to 0 (midnight)', () => {
    const cycle = new DayNightCycle(0, 0.5);
    expect(cycle.timeOfDay).toBeCloseTo(0);
  });

  it('maps 6 hours to 0.25 (sunrise)', () => {
    const cycle = new DayNightCycle(6, 0.5);
    expect(cycle.timeOfDay).toBeCloseTo(0.25);
  });

  it('maps 12 hours to 0.5 (noon)', () => {
    const cycle = new DayNightCycle(12, 0.5);
    expect(cycle.timeOfDay).toBeCloseTo(0.5);
  });

  it('maps 18 hours to 0.75 (sunset)', () => {
    const cycle = new DayNightCycle(18, 0.5);
    expect(cycle.timeOfDay).toBeCloseTo(0.75);
  });

  it('stays in [0, 1) and wraps', () => {
    const cycle = new DayNightCycle(23.999, 0.5);
    expect(cycle.timeOfDay).toBeLessThan(1);
    expect(cycle.timeOfDay).toBeGreaterThanOrEqual(0);
  });

  it('setTimeOfDay sets the clock from a normalized value', () => {
    const cycle = new DayNightCycle(0, 0.5);
    cycle.setTimeOfDay(0.5);
    expect(cycle.currentTime).toBeCloseTo(12);
    cycle.setTimeOfDay(0.25);
    expect(cycle.currentTime).toBeCloseTo(6);
  });
});

describe('DayNightCycle.sunDirection', () => {
  it('points up at noon (timeOfDay 0.5)', () => {
    const cycle = new DayNightCycle(12, 0.5);
    const dir = cycle.sunDirection;
    expect(dir.y).toBeGreaterThan(0.9);
    expect(dir.y).toBeGreaterThan(Math.abs(dir.x));
  });

  it('points east at sunrise (timeOfDay 0.25)', () => {
    const cycle = new DayNightCycle(6, 0.5);
    const dir = cycle.sunDirection;
    expect(dir.y).toBeCloseTo(0, 1);
    expect(dir.x).toBeGreaterThan(0.9);
  });

  it('points west at sunset (timeOfDay 0.75)', () => {
    const cycle = new DayNightCycle(18, 0.5);
    const dir = cycle.sunDirection;
    expect(dir.y).toBeCloseTo(0, 1);
    expect(dir.x).toBeLessThan(-0.9);
  });

  it('points down at midnight (timeOfDay 0)', () => {
    const cycle = new DayNightCycle(0, 0.5);
    const dir = cycle.sunDirection;
    expect(dir.y).toBeLessThan(-0.9);
  });

  it('is normalized (unit length)', () => {
    const cycle = new DayNightCycle(10, 0.5);
    const dir = cycle.sunDirection;
    const len = Math.hypot(dir.x, dir.y, dir.z);
    expect(len).toBeCloseTo(1, 5);
  });

  it('sunDirectionForTimeOfDay static helper matches instance getter', () => {
    const cycle = new DayNightCycle(9, 0.5);
    const a = cycle.sunDirection;
    const b = DayNightCycle.sunDirectionForTimeOfDay(cycle.timeOfDay);
    expect(a.x).toBeCloseTo(b.x, 6);
    expect(a.y).toBeCloseTo(b.y, 6);
    expect(a.z).toBeCloseTo(b.z, 6);
  });
});

describe('DayNightCycle.advance', () => {
  it('advances a full cycle in dayLengthSeconds real seconds', () => {
    const cycle = new DayNightCycle(0, 0.5, 120);
    cycle.advance(60);
    expect(cycle.timeOfDay).toBeCloseTo(0.5, 5);
  });

  it('wraps around at 24 hours', () => {
    const cycle = new DayNightCycle(23, 0.5, 120);
    cycle.advance(10);
    expect(cycle.currentTime).toBeLessThan(24);
    expect(cycle.currentTime).toBeGreaterThanOrEqual(0);
  });

  it('is independent of timeScale', () => {
    const a = new DayNightCycle(0, 0.5, 120);
    const b = new DayNightCycle(0, 99, 120);
    a.advance(30);
    b.advance(30);
    expect(a.timeOfDay).toBeCloseTo(b.timeOfDay, 6);
  });
});
