import { describe, it, expect } from 'vitest';
import {
  CameraUniform,
  CAMERA_UNIFORM_SIZE,
  VIEW_PROJ_OFFSET,
  VIEW_OFFSET,
  PROJ_OFFSET,
  CAMERA_POS_OFFSET,
  TIME_OFFSET,
  type CameraUniformData,
} from '../UniformBuffer.js';
import { FakeDevice, FakeBuffer, asQueue } from './fake.js';

function mat(n: number): Float32Array {
  const a = new Float32Array(16);
  for (let i = 0; i < 16; i++) a[i] = n * 100 + i;
  return a;
}

function makeData(): CameraUniformData {
  return {
    viewProj: { m: mat(1) },
    view: { m: mat(2) },
    proj: { m: mat(3) },
    cameraPos: { x: 1.5, y: 2.5, z: 3.5 },
    time: 42.5,
  };
}

describe('CameraUniform offsets', () => {
  it('places each matrix at a 16-byte-aligned offset, 64 bytes apart', () => {
    expect(VIEW_PROJ_OFFSET).toBe(0);
    expect(VIEW_OFFSET).toBe(64);
    expect(PROJ_OFFSET).toBe(128);
    expect(VIEW_PROJ_OFFSET % 16).toBe(0);
    expect(VIEW_OFFSET % 16).toBe(0);
    expect(PROJ_OFFSET % 16).toBe(0);
    expect(VIEW_OFFSET - VIEW_PROJ_OFFSET).toBe(64);
    expect(PROJ_OFFSET - VIEW_OFFSET).toBe(64);
  });

  it('aligns cameraPos (vec3) to 16 bytes', () => {
    expect(CAMERA_POS_OFFSET).toBe(192);
    expect(CAMERA_POS_OFFSET % 16).toBe(0);
  });

  it('places time immediately after the padded vec4 slot', () => {
    // cameraPos occupies [192, 208) as a padded vec4; time at 208.
    expect(TIME_OFFSET).toBe(208);
    expect(TIME_OFFSET).toBe(CAMERA_POS_OFFSET + 16);
  });

  it('rounds total struct size up to a multiple of 16', () => {
    expect(CAMERA_UNIFORM_SIZE % 16).toBe(0);
    // time(208) + f32(4) + pad(4) = 216 -> round up to 224.
    expect(CAMERA_UNIFORM_SIZE).toBe(224);
  });
});

describe('CameraUniform.write', () => {
  it('writes all fields into the buffer with correct layout', () => {
    const device = new FakeDevice();
    const buffer = device.createBuffer({
      size: CAMERA_UNIFORM_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    }) as unknown as FakeBuffer;
    const writer = new CameraUniform();
    writer.write(buffer as unknown as GPUBuffer, asQueue(device.queue), makeData());

    expect(device.queue.writes).toHaveLength(1);
    const write = device.queue.writes[0]!;
    expect(write.offset).toBe(0);
    const view = write.data as Float32Array;
    expect(view.length).toBe(CAMERA_UNIFORM_SIZE / 4);

    // viewProj at offset 0
    expect(view[0]).toBe(100);
    // view at offset 64
    expect(view[VIEW_OFFSET / 4]).toBe(200);
    // proj at offset 128
    expect(view[PROJ_OFFSET / 4]).toBe(300);
    // cameraPos at offset 192
    expect(view[CAMERA_POS_OFFSET / 4]).toBe(1.5);
    expect(view[CAMERA_POS_OFFSET / 4 + 1]).toBe(2.5);
    expect(view[CAMERA_POS_OFFSET / 4 + 2]).toBe(3.5);
    expect(view[CAMERA_POS_OFFSET / 4 + 3]).toBe(0); // w pad
    // time at offset 208
    expect(view[TIME_OFFSET / 4]).toBe(42.5);
    expect(view[TIME_OFFSET / 4 + 1]).toBe(0); // _pad
  });

  it('exposes SIZE constant matching the computed total', () => {
    expect(CameraUniform.SIZE).toBe(CAMERA_UNIFORM_SIZE);
    expect(CameraUniform.VIEW_PROJ_OFFSET).toBe(0);
    expect(CameraUniform.VIEW_OFFSET).toBe(64);
    expect(CameraUniform.PROJ_OFFSET).toBe(128);
    expect(CameraUniform.CAMERA_POS_OFFSET).toBe(192);
    expect(CameraUniform.TIME_OFFSET).toBe(208);
  });
});
