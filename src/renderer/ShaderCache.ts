/**
 * WGSL shader module cache.
 *
 * Compiles a WGSL source string into a `GPUShaderModule` the first time it is
 * seen and returns the cached module on subsequent calls with identical source.
 * Caching is by FNV-1a hash of the source, so equivalent source strings share
 * a module even if they are different string instances.
 */

import { hashString } from './hash.js';

/** Caches compiled `GPUShaderModule`s by source hash. */
export class ShaderCache {
  private readonly device: GPUDevice;
  private readonly cache = new Map<string, GPUShaderModule>();

  public constructor(device: GPUDevice) {
    this.device = device;
  }

  /**
   * Compile (or return the cached) shader module for `source`.
   * @param source WGSL source text.
   * @returns The compiled `GPUShaderModule`.
   */
  public getShader(source: string): GPUShaderModule {
    const key = hashString(source);
    const existing = this.cache.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const module = this.device.createShaderModule({ code: source });
    this.cache.set(key, module);
    return module;
  }

  /** Number of distinct shader modules currently cached. */
  public get size(): number {
    return this.cache.size;
  }

  /** Drop all cached modules. */
  public clear(): void {
    this.cache.clear();
  }
}
