/**
 * Internal renderer utilities (not public API).
 */

/**
 * Bridge a `Uint8Array` (typed by TS as `Uint8Array<ArrayBufferLike>`) to the
 * `GPUAllowSharedBufferSource` expected by `queue.writeBuffer` /
 * `queue.writeTexture`.
 *
 * Background: TypeScript 5.7+ made the typed arrays generic over their backing
 * buffer. `@webgpu/types`' `GPUAllowSharedBufferSource` requires an
 * `ArrayBuffer`-backed view, but the `Uint8Array` alias defaults to
 * `ArrayBufferLike` (which also permits `SharedArrayBuffer`), so the types
 * don't line up even though every `Uint8Array` produced by `new Uint8Array(n)`
 * is `ArrayBuffer`-backed at runtime. This assertion closes that gap without
 * resorting to `any` or `@ts-ignore`.
 */
export function toGPUBufferSource(data: Uint8Array): GPUAllowSharedBufferSource {
  return data as unknown as GPUAllowSharedBufferSource;
}
