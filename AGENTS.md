# tdjs (3voxel.js) — project notes

WebGPU-first voxel engine. Repo: https://github.com/Vaskrokodile/3voxel.js

## Commands
- `npm run typecheck` — `tsc --noEmit` (checks `src/` only; `examples/` is excluded in tsconfig)
- `npm test` — vitest run (full suite)
- `npm run build` — `vite build` (transforms `src/` + `examples/`; catches import/syntax errors in the example that typecheck skips)
- `npm run dev` — vite dev server (run the example in a browser)

## Key facts
- The example `examples/game.ts` uses inline WGSL shaders and renders directly to the swapchain (now via an HDR post-process chain). It is NOT typechecked by `tsc` — rely on `vite build` to catch module/import errors there.
- Renderer requires `sampleCount: 1` to use `renderToColorView` (offscreen HDR targets). MSAA >1 is incompatible with the post-process path as currently wired.
- `Mat4`/`Float32Array` writes to `device.queue.writeBuffer` need a `as unknown as GPUAllowSharedBufferSource` cast (TS DOM lib types).
- Greedy mesher skips blocks with `meshType: 'none'`; custom-model blocks use that and emit geometry via `buildModelMesh` at chunk-upload time.
- See `ROADMAP.md` for the multi-phase upgrade plan (rendering / lighting / world-gen). Phase 1 (textures, bloom+ACES, sun shadows, custom models) is implemented.
