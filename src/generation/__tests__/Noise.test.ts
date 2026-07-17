import { describe, it, expect } from 'vitest';
import { Noise } from '../Noise.js';

describe('Noise', () => {
  it('is deterministic: same seed => same output', () => {
    const a = new Noise(12345);
    const b = new Noise(12345);
    const c = new Noise(99999);
    for (let i = 0; i < 50; i++) {
      const x = i * 0.37;
      const z = i * 0.91;
      expect(a.noise2D(x, z)).toBe(b.noise2D(x, z));
      expect(a.noise3D(x, i * 0.5, z)).toBe(b.noise3D(x, i * 0.5, z));
    }
    // Different seed should (almost certainly) differ somewhere.
    let anyDiff = false;
    for (let i = 0; i < 50; i++) {
      if (a.noise2D(i * 0.3, i * 0.7) !== c.noise2D(i * 0.3, i * 0.7)) {
        anyDiff = true;
        break;
      }
    }
    expect(anyDiff).toBe(true);
  });

  it('noise2D stays within [-1, 1] over a grid', () => {
    const n = new Noise(1);
    for (let i = 0; i < 100; i++) {
      for (let j = 0; j < 100; j++) {
        const v = n.noise2D(i * 0.13, j * 0.27);
        expect(v).toBeGreaterThanOrEqual(-1);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it('noise3D stays within [-1, 1] over a grid', () => {
    const n = new Noise(2);
    for (let i = 0; i < 30; i++) {
      for (let j = 0; j < 30; j++) {
        for (let k = 0; k < 30; k++) {
          const v = n.noise3D(i * 0.1, j * 0.2, k * 0.3);
          expect(v).toBeGreaterThanOrEqual(-1);
          expect(v).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('fbm2D stays within [-1, 1]', () => {
    const n = new Noise(7);
    for (let i = 0; i < 200; i++) {
      const v = n.fbm2D(i * 0.05, i * 0.08, 4, 2.0, 0.5);
      expect(v).toBeGreaterThanOrEqual(-1.0001);
      expect(v).toBeLessThanOrEqual(1.0001);
    }
  });

  it('fbm3D stays within [-1, 1]', () => {
    const n = new Noise(7);
    for (let i = 0; i < 100; i++) {
      const v = n.fbm3D(i * 0.05, i * 0.08, i * 0.11, 3, 2.0, 0.5);
      expect(v).toBeGreaterThanOrEqual(-1.0001);
      expect(v).toBeLessThanOrEqual(1.0001);
    }
  });
});
