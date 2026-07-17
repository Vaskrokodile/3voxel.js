# tdjs

WebGPU-first voxel engine for infinite, detailed 3D worlds in the browser.

> Work in progress. See `src/` for the subsystem layout.

## Design bets

- **WebGPU-first**, WebGL2 fallback. Compute shaders for GPU meshing/culling, storage buffers, indirect draw.
- **Zero runtime dependencies.** Own math + renderer, not a wrapper.
- **Chunked sparse storage + block palettes** — "infinite" means never holding the world in memory.
- **Off-main-thread meshing** (Worker pool) + a GPU-meshing fast path.
- **ECS-lite**, not a scene graph.
- **Indirect draw + GPU frustum/occlusion cull** — one draw call per chunk, cull on GPU.

## Layout

```
src/
  core/       shared types, math, pooling, events
  renderer/   WebGPU device, pipelines, buffers, textures
  voxel/      Chunk, storage, palettes, world data
  meshing/    greedy mesher, mesh optimization
  threading/  worker pool, chunk worker, message protocol
  world/      World facade, chunk manager, LOD, streaming
  generation/ noise, terrain, biomes
  camera/     camera, frustum
  input/      input manager
  culling/    frustum + occlusion culling
examples/    runnable demos
```

## Develop

```bash
npm install
npm run dev      # vite dev server (examples/)
npm test         # vitest
npm run typecheck
```
