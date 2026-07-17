import { describe, it, expect } from 'vitest';
import {
  AtmosphereUniformWriter,
  ATMOSPHERE_UNIFORM_SIZE,
  SUN_DIRECTION_OFFSET,
  SUN_COLOR_OFFSET,
  AMBIENT_COLOR_OFFSET,
  FOG_COLOR_OFFSET,
  FOG_NEAR_OFFSET,
  FOG_FAR_OFFSET,
  ATMOSPHERE_TIME_OFFSET,
  type AtmosphereUniformData,
} from '../AtmosphereUniforms.js';
import { FakeDevice, FakeBuffer, asQueue } from '../../renderer/__tests__/fake.js';

function makeData(): AtmosphereUniformData {
  return {
    sunDirection: { x: 0.1, y: 0.8, z: 0.2 },
    sunColor: { x: 1.0, y: 0.9, z: 0.8 },
    ambientColor: { x: 0.3, y: 0.3, z: 0.4 },
    fogColor: { x: 0.6, y: 0.7, z: 0.9 },
    fogNear: 12,
    fogFar: 48,
    time: 14.5,
    _pad: 0,
  };
}

describe('AtmosphereUniforms offsets', () => {
  it('places each vec3 field at a 16-byte-aligned offset', () => {
    expect(SUN_DIRECTION_OFFSET).toBe(0);
    expect(SUN_COLOR_OFFSET).toBe(16);
    expect(AMBIENT_COLOR_OFFSET).toBe(32);
    expect(FOG_COLOR_OFFSET).toBe(48);
    expect(SUN_DIRECTION_OFFSET % 16).toBe(0);
    expect(SUN_COLOR_OFFSET % 16).toBe(0);
    expect(AMBIENT_COLOR_OFFSET % 16).toBe(0);
    expect(FOG_COLOR_OFFSET % 16).toBe(0);
  });

  it('places fogNear and fogFar immediately after the vec4s', () => {
    expect(FOG_NEAR_OFFSET).toBe(64);
    expect(FOG_FAR_OFFSET).toBe(68);
    expect(ATMOSPHERE_TIME_OFFSET).toBe(72);
  });

  it('has a total size of 80 bytes (5 vec4s), multiple of 16', () => {
    expect(ATMOSPHERE_UNIFORM_SIZE).toBe(80);
    expect(ATMOSPHERE_UNIFORM_SIZE % 16).toBe(0);
  });
});

describe('AtmosphereUniformWriter.write', () => {
  it('writes all fields into the buffer with correct layout', () => {
    const device = new FakeDevice();
    const buffer = device.createBuffer({
      size: ATMOSPHERE_UNIFORM_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    }) as unknown as FakeBuffer;
    const writer = new AtmosphereUniformWriter();
    writer.write(buffer as unknown as GPUBuffer, asQueue(device.queue), makeData());

    expect(device.queue.writes).toHaveLength(1);
    const write = device.queue.writes[0]!;
    expect(write.offset).toBe(0);
    const view = write.data as Float32Array;
    expect(view.length).toBe(ATMOSPHERE_UNIFORM_SIZE / 4);

    // sunDirection at offset 0 (w = 0)
    expect(view[SUN_DIRECTION_OFFSET / 4]).toBeCloseTo(0.1);
    expect(view[SUN_DIRECTION_OFFSET / 4 + 1]).toBeCloseTo(0.8);
    expect(view[SUN_DIRECTION_OFFSET / 4 + 2]).toBeCloseTo(0.2);
    expect(view[SUN_DIRECTION_OFFSET / 4 + 3]).toBe(0);

    // sunColor at offset 16
    expect(view[SUN_COLOR_OFFSET / 4]).toBeCloseTo(1.0);
    expect(view[SUN_COLOR_OFFSET / 4 + 1]).toBeCloseTo(0.9);
    expect(view[SUN_COLOR_OFFSET / 4 + 2]).toBeCloseTo(0.8);
    expect(view[SUN_COLOR_OFFSET / 4 + 3]).toBe(0);

    // ambientColor at offset 32
    expect(view[AMBIENT_COLOR_OFFSET / 4]).toBeCloseTo(0.3);
    expect(view[AMBIENT_COLOR_OFFSET / 4 + 1]).toBeCloseTo(0.3);
    expect(view[AMBIENT_COLOR_OFFSET / 4 + 2]).toBeCloseTo(0.4);
    expect(view[AMBIENT_COLOR_OFFSET / 4 + 3]).toBe(0);

    // fogColor at offset 48
    expect(view[FOG_COLOR_OFFSET / 4]).toBeCloseTo(0.6);
    expect(view[FOG_COLOR_OFFSET / 4 + 1]).toBeCloseTo(0.7);
    expect(view[FOG_COLOR_OFFSET / 4 + 2]).toBeCloseTo(0.9);
    expect(view[FOG_COLOR_OFFSET / 4 + 3]).toBe(0);

    // fogNear / fogFar / time
    expect(view[FOG_NEAR_OFFSET / 4]).toBeCloseTo(12);
    expect(view[FOG_FAR_OFFSET / 4]).toBeCloseTo(48);
    expect(view[ATMOSPHERE_TIME_OFFSET / 4]).toBeCloseTo(14.5);
    expect(view[ATMOSPHERE_TIME_OFFSET / 4 + 1]).toBe(0); // _pad
  });

  it('exposes SIZE constant matching the computed total', () => {
    expect(AtmosphereUniformWriter.SIZE).toBe(ATMOSPHERE_UNIFORM_SIZE);
  });
});
