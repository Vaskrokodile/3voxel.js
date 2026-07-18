/**
 * Tests for the water uniform buffer layout, writer, and defaults.
 */

import { describe, it, expect } from 'vitest';
import {
  WaterUniformWriter,
  WATER_UNIFORM_SIZE,
  WATER_COLOR_OFFSET,
  WATER_DEPTH_OFFSET,
  WAVE_AMPLITUDE_OFFSET,
  WATER_TIME_OFFSET,
  DEFAULT_WATER_COLOR,
  DEFAULT_WATER_DEPTH,
  DEFAULT_WAVE_AMPLITUDE,
  defaultWaterUniformData,
  type WaterUniformData,
} from '../WaterUniform.js';
import { FakeDevice, FakeBuffer, asQueue } from '../../renderer/__tests__/fake.js';

function makeData(): WaterUniformData {
  return {
    waterColor: { x: 0.2, y: 0.5, z: 0.7 },
    waterDepth: 0.8,
    waveAmplitude: 0.04,
    time: 12.5,
  };
}

describe('WaterUniform defaults', () => {
  it('exposes default water color, depth, and wave amplitude', () => {
    expect(DEFAULT_WATER_COLOR.x).toBeGreaterThan(0);
    expect(DEFAULT_WATER_COLOR.y).toBeGreaterThan(DEFAULT_WATER_COLOR.x);
    expect(DEFAULT_WATER_COLOR.z).toBeGreaterThan(DEFAULT_WATER_COLOR.y);
    expect(DEFAULT_WATER_DEPTH).toBe(1.0);
    expect(DEFAULT_WAVE_AMPLITUDE).toBe(0.05);
  });

  it('defaultWaterUniformData returns the engine defaults with time 0', () => {
    const d = defaultWaterUniformData();
    expect(d.waterColor.x).toBe(DEFAULT_WATER_COLOR.x);
    expect(d.waterColor.y).toBe(DEFAULT_WATER_COLOR.y);
    expect(d.waterColor.z).toBe(DEFAULT_WATER_COLOR.z);
    expect(d.waterDepth).toBe(DEFAULT_WATER_DEPTH);
    expect(d.waveAmplitude).toBe(DEFAULT_WAVE_AMPLITUDE);
    expect(d.time).toBe(0);
  });

  it('defaultWaterUniformData accepts a time override', () => {
    const d = defaultWaterUniformData(42);
    expect(d.time).toBe(42);
    expect(d.waveAmplitude).toBe(DEFAULT_WAVE_AMPLITUDE);
  });
});

describe('WaterUniform offsets', () => {
  it('places waterColor at offset 0 (16-byte aligned)', () => {
    expect(WATER_COLOR_OFFSET).toBe(0);
    expect(WATER_COLOR_OFFSET % 16).toBe(0);
  });

  it('places waterDepth, waveAmplitude, and time after the vec4', () => {
    expect(WATER_DEPTH_OFFSET).toBe(16);
    expect(WAVE_AMPLITUDE_OFFSET).toBe(20);
    expect(WATER_TIME_OFFSET).toBe(24);
  });

  it('has a total size of 32 bytes (2 vec4s), multiple of 16', () => {
    expect(WATER_UNIFORM_SIZE).toBe(32);
    expect(WATER_UNIFORM_SIZE % 16).toBe(0);
  });
});

describe('WaterUniformWriter.write', () => {
  it('writes all fields into the buffer with the correct layout', () => {
    const device = new FakeDevice();
    const buffer = device.createBuffer({
      size: WATER_UNIFORM_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    }) as unknown as FakeBuffer;
    const writer = new WaterUniformWriter();
    writer.write(buffer as unknown as GPUBuffer, asQueue(device.queue), makeData());

    expect(device.queue.writes).toHaveLength(1);
    const write = device.queue.writes[0]!;
    expect(write.offset).toBe(0);
    const view = write.data as Float32Array;
    expect(view.length).toBe(WATER_UNIFORM_SIZE / 4);

    expect(view[WATER_COLOR_OFFSET / 4]).toBeCloseTo(0.2);
    expect(view[WATER_COLOR_OFFSET / 4 + 1]).toBeCloseTo(0.5);
    expect(view[WATER_COLOR_OFFSET / 4 + 2]).toBeCloseTo(0.7);
    expect(view[WATER_COLOR_OFFSET / 4 + 3]).toBe(0);

    expect(view[WATER_DEPTH_OFFSET / 4]).toBeCloseTo(0.8);
    expect(view[WAVE_AMPLITUDE_OFFSET / 4]).toBeCloseTo(0.04);
    expect(view[WATER_TIME_OFFSET / 4]).toBeCloseTo(12.5);
    expect(view[WATER_TIME_OFFSET / 4 + 1]).toBe(0);
  });

  it('exposes SIZE constant matching the computed total', () => {
    expect(WaterUniformWriter.SIZE).toBe(WATER_UNIFORM_SIZE);
  });
});
