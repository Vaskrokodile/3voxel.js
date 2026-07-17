/**
 * Tests for the fluent ShaderBuilder: ordering of chunks, bindings, and
 * entry-point functions in the assembled output.
 */

import { describe, it, expect } from 'vitest';
import { ShaderBuilder } from '../ShaderBuilder.js';

describe('ShaderBuilder', () => {
  it('assembles chunks, bindings, vertex fn, and fragment fn in order', () => {
    const src = new ShaderBuilder()
      .include('camera_uniform')
      .include('voxel_vertex_input')
      .addBinding(0, 0, 'camera', 'CameraUniform', 'uniform')
      .setVertexFunction('@vertex fn vs_main() -> VertexOutput { return VertexOutput(); }')
      .setFragmentFunction('@fragment fn fs_main() -> @location(0) vec4<f32> { return vec4<f32>(1.0); }')
      .build();

    const chunkIdx = src.indexOf('// chunk: camera_uniform');
    const bindingIdx = src.indexOf('// bindings');
    const vertIdx = src.indexOf('// vertex entry point');
    const fragIdx = src.indexOf('// fragment entry point');

    expect(chunkIdx).toBeGreaterThanOrEqual(0);
    expect(bindingIdx).toBeGreaterThan(chunkIdx);
    expect(vertIdx).toBeGreaterThan(bindingIdx);
    expect(fragIdx).toBeGreaterThan(vertIdx);
  });

  it('emits a well-formed @group/@binding declaration', () => {
    const src = new ShaderBuilder()
      .addBinding(1, 2, 'atmosphere', 'AtmosphereUniform', 'uniform')
      .setVertexFunction('@vertex fn vs_main() {}')
      .build();
    expect(src).toContain('@group(1) @binding(2) var<uniform> atmosphere : AtmosphereUniform;');
  });

  it('emits storage bindings with the correct address space', () => {
    const src = new ShaderBuilder()
      .addBinding(0, 1, 'verts', 'array<vec4<f32>>', 'storage')
      .setVertexFunction('@vertex fn vs_main() {}')
      .build();
    expect(src).toContain('var<storage> verts : array<vec4<f32>>;');
  });

  it('throws if no entry point is set', () => {
    expect(() => new ShaderBuilder().include('camera_uniform').build()).toThrow();
  });

  it('does not duplicate chunks included more than once', () => {
    const src = new ShaderBuilder()
      .include('camera_uniform')
      .include('camera_uniform')
      .setVertexFunction('@vertex fn vs_main() {}')
      .build();
    const matches = src.match(/\/\/ chunk: camera_uniform/g);
    expect(matches).toHaveLength(1);
  });

  it('pulls in transitive dependencies', () => {
    const src = new ShaderBuilder()
      .include('sun_lighting')
      .setFragmentFunction('@fragment fn fs_main() {}')
      .build();
    expect(src).toContain('// chunk: atmosphere_uniform');
    expect(src).toContain('// chunk: sun_lighting');
  });
});
