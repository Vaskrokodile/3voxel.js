/**
 * Post-process render pass hook (future).
 *
 * Describes a single fullscreen post-processing stage that reads from an input
 * texture and writes to an output texture. Not yet implemented; defined so the
 * demo can later add tone mapping / bloom passes behind a stable interface.
 */
export interface PostProcessPass {
  /** Stable name (used for lookup and debugging). */
  readonly name: string;
  /** Input color texture view (the rendered scene to process). */
  readonly inputTexture: GPUTextureView;
  /** Output color texture view (the processed result). */
  readonly outputTexture: GPUTextureView;
  /**
   * Encode the post-process draw into `encoder`. Implementations should begin
   * a render pass targeting `outputTexture`, bind `inputTexture`, and draw a
   * fullscreen triangle.
   */
  render(encoder: GPUCommandEncoder): void;
}
