/**
 * WebGPU device acquisition.
 *
 * Requests an adapter + device, acquires the canvas WebGPU context, and
 * configures it with the adapter's preferred format and `premultiplied` alpha
 * mode. If WebGPU is unavailable (no `navigator.gpu`, no adapter, or device
 * request rejected) a {@link RendererError} is thrown — there is NO silent
 * fallback to a different backend.
 */

import type { Logger } from '../core/types.js';
import { RendererError } from './types.js';

/** Result of {@link createDevice}: everything needed to talk to the GPU. */
export interface Device {
  readonly device: GPUDevice;
  readonly queue: GPUQueue;
  readonly context: GPUCanvasContext;
  /** Preferred swapchain format (e.g. `bgra8unorm`). */
  readonly format: GPUTextureFormat;
  readonly canvas: HTMLCanvasElement;
}

/**
 * Acquire a WebGPU device and configure the given canvas for rendering.
 *
 * @throws {RendererError} if WebGPU is unavailable or device creation fails.
 */
export async function createDevice(canvas: HTMLCanvasElement, logger?: Logger): Promise<Device> {
  const nav = navigator as Navigator & { gpu?: GPU };
  if (typeof nav.gpu === 'undefined') {
    const err = new RendererError('WebGPU is not available: navigator.gpu is undefined.', {
      hint: 'Use a WebGPU-enabled browser (Chrome/Edge 113+) over HTTPS or localhost.',
    });
    logger?.log('error', err.message, err.context);
    throw err;
  }

  const gpu = nav.gpu;
  let adapter: GPUAdapter | null;
  try {
    adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
  } catch (e) {
    const err = new RendererError('requestAdapter() threw.', {
      cause: e instanceof Error ? e.message : String(e),
    });
    logger?.log('error', err.message, err.context);
    throw err;
  }
  if (adapter === null) {
    const err = new RendererError('No suitable GPUAdapter found.');
    logger?.log('error', err.message);
    throw err;
  }

  let device: GPUDevice;
  try {
    device = await adapter.requestDevice({
      requiredFeatures: [],
      requiredLimits: {},
    });
  } catch (e) {
    const err = new RendererError('requestDevice() was rejected.', {
      cause: e instanceof Error ? e.message : String(e),
    });
    logger?.log('error', err.message, err.context);
    throw err;
  }

  const context = canvas.getContext('webgpu');
  if (context === null) {
    const err = new RendererError('canvas.getContext("webgpu") returned null.');
    logger?.log('error', err.message);
    throw err;
  }

  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({
    device,
    format,
    alphaMode: 'premultiplied',
  });

  logger?.log('info', 'WebGPU device acquired.', {
    format,
    vendor: adapter.info?.vendor,
    architecture: adapter.info?.architecture,
  });

  return { device, queue: device.queue, context, format, canvas };
}
