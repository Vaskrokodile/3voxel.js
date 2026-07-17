/**
 * Fluent builder for complete WGSL shaders.
 *
 * Wraps {@link buildShader} with a convenient chainable API: include named
 * chunks, declare uniform/storage bindings, and set the vertex + fragment
 * entry-point functions. {@link ShaderBuilder.build} concatenates everything in
 * a fixed, predictable order:
 *
 *   1. resolved chunk sources (dependency-ordered, de-duplicated)
 *   2. binding declarations (in insertion order)
 *   3. vertex entry-point function
 *   4. fragment entry-point function
 */

import { buildShader, type ShaderChunk } from './ShaderLibrary.js';

/** A single `@group/@binding` declaration produced by `addBinding`. */
interface BindingDecl {
  readonly group: number;
  readonly binding: number;
  readonly name: string;
  readonly type: string;
  readonly space: 'uniform' | 'storage';
}

/**
 * Chainable shader builder. Each mutator returns `this` so calls can be
 * composed fluently:
 *
 * ```ts
 * const src = new ShaderBuilder()
 *   .include('camera_uniform')
 *   .addBinding(0, 0, 'camera', 'CameraUniform', 'uniform')
 *   .setVertexFunction(`@vertex fn vs_main(...) { ... }`)
 *   .setFragmentFunction(`@fragment fn fs_main(...) { ... }`)
 *   .build();
 * ```
 */
export class ShaderBuilder {
  private readonly chunkNames: string[] = [];
  private readonly bindings: BindingDecl[] = [];
  private vertexFn: string | null = null;
  private fragmentFn: string | null = null;

  /** Include a named chunk (dependencies are pulled in automatically). */
  public include(chunkName: string): this {
    if (!this.chunkNames.includes(chunkName)) {
      this.chunkNames.push(chunkName);
    }
    return this;
  }

  /**
   * Declare a `@group(g) @binding(b) var<space> name : type;` binding.
   *
   * @param group   `@group(n)` index.
   * @param binding `@binding(n)` index within the group.
   * @param name    The WGSL variable name (referenced by shader functions).
   * @param type    The WGSL type name (e.g. `CameraUniform`, `Texture2D`).
   * @param space   Address space: `uniform` or `storage`.
   */
  public addBinding(
    group: number,
    binding: number,
    name: string,
    type: string,
    space: 'uniform' | 'storage',
  ): this {
    this.bindings.push({ group, binding, name, type, space });
    return this;
  }

  /** Set the `@vertex` entry-point function body (including the `@vertex` attr). */
  public setVertexFunction(fn: string): this {
    this.vertexFn = fn;
    return this;
  }

  /** Set the `@fragment` entry-point function body (including the `@fragment` attr). */
  public setFragmentFunction(fn: string): this {
    this.fragmentFn = fn;
    return this;
  }

  /**
   * Assemble the final WGSL source.
   *
   * Order: chunks → bindings → vertex fn → fragment fn. Throws if neither
   * entry point has been set.
   */
  public build(): string {
    const parts: string[] = [];
    if (this.chunkNames.length > 0) {
      parts.push(buildShader(this.chunkNames));
    }
    if (this.bindings.length > 0) {
      const lines = this.bindings.map(
        (b) =>
          `@group(${b.group}) @binding(${b.binding}) var<${b.space}> ${b.name} : ${b.type};`,
      );
      parts.push(`// bindings\n${lines.join('\n')}`);
    }
    if (this.vertexFn !== null) {
      parts.push(`// vertex entry point\n${this.vertexFn}`);
    }
    if (this.fragmentFn !== null) {
      parts.push(`// fragment entry point\n${this.fragmentFn}`);
    }
    if (this.vertexFn === null && this.fragmentFn === null) {
      throw new Error('ShaderBuilder.build() called without vertex or fragment function.');
    }
    return parts.join('\n\n') + '\n';
  }
}

/** Re-export for callers that want the chunk type alongside the builder. */
export type { ShaderChunk };
