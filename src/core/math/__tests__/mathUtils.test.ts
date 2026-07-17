import { describe, it, expect } from 'vitest';
import {
  clamp,
  lerp,
  degToRad,
  radToDeg,
  EPSILON,
  isPowerOfTwo,
  nextPowerOfTwo,
  hashInt,
} from '../mathUtils.js';

describe('mathUtils', () => {
  it('clamp constrains to range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });

  it('lerp interpolates', () => {
    expect(lerp(0, 10, 0.5)).toBe(5);
    expect(lerp(2, 4, 0)).toBe(2);
    expect(lerp(2, 4, 1)).toBe(4);
  });

  it('degToRad / radToDeg are inverses', () => {
    expect(degToRad(180)).toBeCloseTo(Math.PI);
    expect(radToDeg(Math.PI)).toBeCloseTo(180);
    expect(radToDeg(degToRad(45))).toBeCloseTo(45);
  });

  it('EPSILON is a small positive number', () => {
    expect(EPSILON).toBeGreaterThan(0);
    expect(EPSILON).toBeLessThan(1e-3);
  });

  it('isPowerOfTwo', () => {
    expect(isPowerOfTwo(1)).toBe(true);
    expect(isPowerOfTwo(2)).toBe(true);
    expect(isPowerOfTwo(16)).toBe(true);
    expect(isPowerOfTwo(3)).toBe(false);
    expect(isPowerOfTwo(0)).toBe(false);
    expect(isPowerOfTwo(-4)).toBe(false);
  });

  it('nextPowerOfTwo', () => {
    expect(nextPowerOfTwo(1)).toBe(1);
    expect(nextPowerOfTwo(3)).toBe(4);
    expect(nextPowerOfTwo(17)).toBe(32);
    expect(nextPowerOfTwo(0)).toBe(1);
    expect(nextPowerOfTwo(-5)).toBe(1);
  });

  it('hashInt is deterministic and differs for inputs', () => {
    const a = hashInt(0, 0, 0);
    const b = hashInt(0, 0, 0);
    expect(a).toBe(b);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThanOrEqual(0xffffffff);
    // Different inputs should (very likely) differ.
    expect(hashInt(1, 0, 0)).not.toBe(hashInt(0, 1, 0));
    expect(hashInt(1, 0, 0)).not.toBe(a);
  });
});
