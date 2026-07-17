/**
 * tdjs WebGPU renderer.
 *
 * The renderer is layout-agnostic: it never hardcodes the mesher's vertex
 * layout. The mesher owns the interleaved vertex byte layout and hands the
 * renderer a {@link VertexLayout} descriptor; the renderer builds the
 * corresponding `GPUVertexBufferLayout` from it. See `types.ts` and the header
 * of `UniformBuffer.ts` for the exact byte layouts other subsystems must match.
 */

export type {
  VertexAttribute,
  VertexLayout,
  UniformBindGroup,
  DrawSubmission,
  RendererOptions,
} from './types.js';
export { RendererError } from './types.js';

export { createDevice, type Device } from './Device.js';

export { ShaderCache } from './ShaderCache.js';

export {
  PipelineCache,
  PipelineKeyBuilder,
  toVertexBufferLayout,
  type PipelineKeyParts,
} from './PipelineCache.js';

export { BufferManager, roundUp16, POOLED_SIZES } from './BufferManager.js';

export {
  CameraUniform,
  type CameraUniformData,
  VIEW_PROJ_OFFSET,
  VIEW_OFFSET,
  PROJ_OFFSET,
  CAMERA_POS_OFFSET,
  TIME_OFFSET,
  CAMERA_UNIFORM_SIZE,
} from './UniformBuffer.js';

export {
  TextureManager,
  type TextureArrayOptions,
  type SamplerOptions,
} from './TextureManager.js';

export { CommandRecorder, type FrameAttachments } from './CommandRecorder.js';

export { Renderer } from './Renderer.js';
