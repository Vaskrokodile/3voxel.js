import { describe, it, expect, beforeEach } from 'vitest';
import { SkyRenderer } from '../SkyRenderer.js';
import { asDevice, asQueue, asFakeBuffer, resetAtmFakeCounters, AtmFakeDevice } from './fake.js';

const FORMAT: GPUTextureFormat = 'bgra8unorm';
const DEPTH_FORMAT: GPUTextureFormat = 'depth24plus';

function makeRenderer(): { renderer: SkyRenderer; device: AtmFakeDevice } {
  const device = new AtmFakeDevice();
  const renderer = new SkyRenderer({
    device: asDevice(device),
    format: FORMAT,
    sampleCount: 4,
    depthFormat: DEPTH_FORMAT,
  });
  return { renderer, device };
}

describe('SkyRenderer.update — sun direction', () => {
  beforeEach(() => resetAtmFakeCounters());

  it('points roughly upward at noon (time 12)', () => {
    const { renderer } = makeRenderer();
    renderer.update(12);
    const dir = renderer.sunDirection;
    // At noon, angle = (12-6)*PI/12 = PI/2, so sin = 1, cos = 0.
    // sunDir = normalize(0, 1, 0.3) → y is the largest component.
    expect(dir.y).toBeGreaterThan(0.9);
    expect(dir.y).toBeGreaterThan(Math.abs(dir.x));
    expect(dir.y).toBeGreaterThan(Math.abs(dir.z));
  });

  it('points toward the horizon at sunrise (time 6)', () => {
    const { renderer } = makeRenderer();
    renderer.update(6);
    const dir = renderer.sunDirection;
    // At sunrise, angle = 0, so cos = 1, sin = 0.
    // sunDir = normalize(1, 0, 0.3) → y ≈ 0, x is largest.
    expect(dir.y).toBeCloseTo(0, 1);
    expect(dir.x).toBeGreaterThan(0.9);
  });

  it('points toward the horizon (west) at sunset (time 18)', () => {
    const { renderer } = makeRenderer();
    renderer.update(18);
    const dir = renderer.sunDirection;
    // At sunset, angle = PI, cos = -1, sin = 0.
    expect(dir.y).toBeCloseTo(0, 1);
    expect(dir.x).toBeLessThan(-0.9);
  });

  it('is below the horizon at midnight (time 0)', () => {
    const { renderer } = makeRenderer();
    renderer.update(0);
    const dir = renderer.sunDirection;
    // angle = (0-6)*PI/12 = -PI/2, sin = -1.
    expect(dir.y).toBeLessThan(-0.9);
  });

  it('is normalized (unit length)', () => {
    const { renderer } = makeRenderer();
    renderer.update(10);
    const dir = renderer.sunDirection;
    const len = Math.hypot(dir.x, dir.y, dir.z);
    expect(len).toBeCloseTo(1, 5);
  });
});

describe('SkyRenderer.update — sun color transitions', () => {
  beforeEach(() => resetAtmFakeCounters());

  it('is white-ish at noon', () => {
    const { renderer } = makeRenderer();
    renderer.update(12);
    const c = renderer.sunColor;
    expect(c.x).toBeGreaterThan(0.9);
    expect(c.y).toBeGreaterThan(0.85);
    expect(c.z).toBeGreaterThan(0.8);
  });

  it('is warm orange at sunrise', () => {
    const { renderer } = makeRenderer();
    renderer.update(6);
    const c = renderer.sunColor;
    // At sunrise, sunHeight ≈ 0, so dayBlend ≈ 0, nightBlend ≈ 0.
    // Color should be close to HORIZON_SUN (1.0, 0.6, 0.3).
    expect(c.x).toBeCloseTo(1.0, 1);
    expect(c.y).toBeLessThan(0.7);
    expect(c.z).toBeLessThan(0.5);
  });

  it('is dim blue at midnight', () => {
    const { renderer } = makeRenderer();
    renderer.update(0);
    const c = renderer.sunColor;
    // At midnight, sunHeight ≈ -1, nightBlend ≈ 1.
    // Color should be close to NIGHT_SUN (0.1, 0.1, 0.2).
    expect(c.x).toBeLessThan(0.2);
    expect(c.y).toBeLessThan(0.2);
    expect(c.z).toBeGreaterThan(c.x);
  });

  it('transitions smoothly (no popping) between noon and sunset', () => {
    const { renderer } = makeRenderer();
    renderer.update(12);
    const noon = renderer.sunColor;
    renderer.update(15);
    const mid = renderer.sunColor;
    renderer.update(18);
    const sunset = renderer.sunColor;
    // Each step should be a gradual change, not a jump.
    const step1 = Math.abs(noon.x - mid.x);
    const step2 = Math.abs(mid.x - sunset.x);
    expect(step1).toBeLessThan(0.5);
    expect(step2).toBeLessThan(0.5);
    // Overall, x stays high (warm).
    expect(sunset.x).toBeCloseTo(1.0, 1);
  });
});

describe('SkyRenderer.update — ambient and fog', () => {
  beforeEach(() => resetAtmFakeCounters());

  it('ambient is brighter at noon than at midnight', () => {
    const { renderer } = makeRenderer();
    renderer.update(12);
    const dayAmbient = renderer.ambientColor;
    renderer.update(0);
    const nightAmbient = renderer.ambientColor;
    expect(dayAmbient.x).toBeGreaterThan(nightAmbient.x);
    expect(dayAmbient.y).toBeGreaterThan(nightAmbient.y);
    expect(dayAmbient.z).toBeGreaterThan(nightAmbient.z);
  });

  it('fog color is light blue during day, dark at night', () => {
    const { renderer } = makeRenderer();
    renderer.update(12);
    const dayFog = renderer.fogColor;
    renderer.update(0);
    const nightFog = renderer.fogColor;
    expect(dayFog.x).toBeGreaterThan(nightFog.x);
    expect(dayFog.y).toBeGreaterThan(nightFog.y);
  });

  it('fog color has warm tint at sunset', () => {
    const { renderer } = makeRenderer();
    renderer.update(18);
    const sunsetFog = renderer.fogColor;
    // At sunset, sunsetFactor is high, so fog leans toward SUNSET_FOG (1, 0.6, 0.3).
    expect(sunsetFog.x).toBeGreaterThan(sunsetFog.z);
  });
});

describe('SkyRenderer.getSubmission', () => {
  beforeEach(() => resetAtmFakeCounters());

  it('returns a DrawSubmission with 3 indices and uint16 format', () => {
    const { renderer, device } = makeRenderer();
    const fakeCam = device.createBuffer({
      size: 224,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const sub = renderer.getSubmission(fakeCam);
    expect(sub.indexCount).toBe(3);
    expect(sub.indexFormat).toBe('uint16');
    expect(sub.uniforms).toHaveLength(2);
    expect(sub.uniforms[0]!.groupIndex).toBe(0);
    expect(sub.uniforms[1]!.groupIndex).toBe(1);
  });

  it('creates vertex and index buffers of correct size', () => {
    const { renderer, device } = makeRenderer();
    // The constructor already created buffers; verify via queue writes.
    // 3 vertices × 2 floats × 4 bytes = 24 bytes for vertices.
    // 3 indices × 2 bytes = 6 bytes, padded to 8 (multiple of 4 for WebGPU).
    const vertexWrite = device.queue.writes.find((w) => {
      const buf = asFakeBuffer(w.buffer);
      return buf.size === 24;
    });
    const indexWrite = device.queue.writes.find((w) => {
      const buf = asFakeBuffer(w.buffer);
      return buf.size === 8;
    });
    expect(vertexWrite).toBeDefined();
    expect(indexWrite).toBeDefined();
  });

  it('writes atmosphere uniform data on update', () => {
    const { renderer, device } = makeRenderer();
    const beforeCount = device.queue.writes.length;
    renderer.update(12);
    expect(device.queue.writes.length).toBeGreaterThan(beforeCount);
  });

  it('caches the camera bind group for the same buffer', () => {
    const { renderer, device } = makeRenderer();
    const fakeCam = device.createBuffer({
      size: 224,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const sub1 = renderer.getSubmission(fakeCam);
    const sub2 = renderer.getSubmission(fakeCam);
    expect(sub1.uniforms[0]!.bindGroup).toBe(sub2.uniforms[0]!.bindGroup);
  });
});

describe('SkyRenderer.shaderSource', () => {
  it('contains valid WGSL entry points', () => {
    const src = SkyRenderer.shaderSource;
    expect(src).toContain('@vertex');
    expect(src).toContain('@fragment');
    expect(src).toContain('fn vs_main');
    expect(src).toContain('fn fs_main');
    expect(src).toContain('CameraUniform');
    expect(src).toContain('AtmosphereUniform');
  });
});
