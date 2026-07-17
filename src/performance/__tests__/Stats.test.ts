import { describe, expect, it } from 'vitest';
import { Stats } from '../Stats.js';
import type { PerfStats } from '../Stats.js';

function makeStats(overrides: Partial<PerfStats> = {}): PerfStats {
  return {
    fps: 60,
    frameTime: 16.6,
    chunkCount: 100,
    meshedChunks: 90,
    drawCalls: 50,
    triangles: 12000,
    gpuTimeEstimate: 5,
    memoryEstimate: 1024 * 1024 * 16,
    ...overrides,
  };
}

describe('Stats', () => {
  it('getLatest returns null before any record', () => {
    const s = new Stats(10);
    expect(s.getLatest()).toBeNull();
  });

  it('record + getLatest returns the most recent snapshot', () => {
    const s = new Stats(10);
    s.record(makeStats({ fps: 55 }));
    s.record(makeStats({ fps: 62 }));
    const latest = s.getLatest();
    expect(latest).not.toBeNull();
    expect(latest!.fps).toBe(62);
  });

  it('getAverage averages over the recorded history', () => {
    const s = new Stats(10);
    s.record(makeStats({ fps: 60, frameTime: 16 }));
    s.record(makeStats({ fps: 30, frameTime: 33 }));
    const avg = s.getAverage();
    expect(avg.fps).toBeCloseTo(45, 5);
    expect(avg.frameTime).toBeCloseTo(24.5, 5);
  });

  it('getAverage returns zeros when empty', () => {
    const s = new Stats(10);
    const avg = s.getAverage();
    expect(avg.fps).toBe(0);
    expect(avg.triangles).toBe(0);
  });

  it('format produces a multi-line string with key metrics', () => {
    const s = new Stats(10);
    s.record(makeStats({ fps: 60, triangles: 12000, memoryEstimate: 1024 * 1024 * 16 }));
    const out = s.format();
    expect(out).toContain('fps:');
    expect(out).toContain('60.0');
    expect(out).toContain('tris:');
    expect(out).toContain('mem:');
    expect(out.split('\n').length).toBe(7);
  });

  it('rolling window overwrites oldest entries without growing', () => {
    const s = new Stats(3);
    s.record(makeStats({ fps: 10 }));
    s.record(makeStats({ fps: 20 }));
    s.record(makeStats({ fps: 30 }));
    s.record(makeStats({ fps: 40 }));
    // Window size 3 -> average of 20,30,40 = 30.
    const avg = s.getAverage();
    expect(avg.fps).toBeCloseTo(30, 5);
  });
});
