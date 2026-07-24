# tdjs upgrade roadmap — toward a detailed Japanese sanctuary

Goal: take tdjs from a capable v0.3.0 WebGPU voxel engine to a renderer capable
of an "insane attention to detail" Japanese sanctuary scene opened in the
browser, with orders-of-magnitude better visuals and throughput.

This document is honest about scope. "Orders of magnitude in every dimension"
is a multi-phase, multi-session effort. Each phase is designed to ship a
working, tested, visible improvement without breaking what exists.

## Current state (baseline)

- ~19.5k lines TS, 475 tests passing, build green.
- Greedy meshing with baked vertex AO; palette-backed 16/32/64³ chunks.
- WebGPU renderer: MSAA, depth, shader-chunk system, material system.
- Atmosphere: sky dome, sun+ambient, fog, day-night cycle.
- Simple water (fresnel + shimmer), worker-pool meshing, GPU frustum cull,
  physics, interaction, LOD/streaming, BigChunk/SparseOctree (voxel2).
- **Gaps:** flat per-block colors (no texture sampling in the live path),
  no shadows, no GI, no PBR, no post-process (PostProcess.ts is a stub),
  no custom/non-cube block models, no sanctuary content.

## Phase 1 — Foundations (this session, shallow across all three pillars)

Balanced, moderate-depth pass that lays reusable engine infrastructure and
wires the example to use it. Engine-first; no world content yet.

- **1A Textures & materials:** integrate the existing procedural
  `TextureAtlas` into the live render path. Per-block face→texture mapping,
  atlas UVs baked into vertices, atlas sampled in the world fragment shader.
  Replaces flat color-table lookup for textured blocks.
- **1B Lighting & post-process:** offscreen HDR scene target + ACES tone
  mapping + a simple separable bloom. `PostProcess.ts` goes from stub to a
  real `PostProcessChain`.
- **1C Shadows:** directional sun shadow map, single cascade, PCF sampling,
  shadow factor folded into the world fragment lighting.
- **1D Custom block models:** `model` mesh type + box-list `BlockModel`
  definitions + a model mesher, so non-cube geometry (torii, lanterns, roof
  beams) can be authored. No culling between model boxes yet (phase 2).

Phase 1 deliverable: visibly upgraded example (textured, shadowed, bloomed,
tone-mapped) with custom-model blocks available, all tests + build green.

## Phase 2 — Detail & fidelity (future sessions)

- Per-voxel texture tiling across merged quads (texture arrays or atlas
  padding) instead of stretched UVs.
- Cascaded shadow maps (CSM) + shadow bias/peter-panning fixes + soft PCF.
- SSAO / GTAO; screen-space ray-traced reflections for water.
- PBR material model (metalness/roughness) + emissive blocks (lanterns).
- Volumetric fog / god-rays through torii gaps.
- Model-box internal face culling + model UVs per face.
- Higher-resolution (32/64px) procedural textures + mip generation.

## Phase 3 — Scale & performance (future sessions)

- GPU meshing fast path (compute-shader meshing) for huge voxel counts.
- Indirect draw + GPU frustum/occlusion cull (one draw per chunk).
- Chunk virtualization / streaming from disk (IndexedDB) for infinite worlds.
- Larger chunk sizes (64³/128³) with sub-chunk meshing already in place.
- Frame budget adaptive LOD tied to shadow/post cost.

## Phase 4 — Sanctuary world (future sessions)

- Japanese block set: cedar wood (planks, beams, bark), stone lanterns
  (tōrō), paper screens (shōji), tatami, roof tiles, moss, gravel, water.
- Custom models: torii gate, tōrō lantern (with emissive), curved roof
  (irimoya), cherry blossom planes, bridge, koi.
- Authored scene layout (hand-placed + procedural accents), garden terrain.
- Day-night + lantern bloom showcase; cinematic camera path for web demo.

## Non-goals / explicit trade-offs

- Not wrapping three.js; tdjs stays zero-runtime-dependency and WebGPU-first.
- Not chasing "orders of magnitude" in one session — phased, verifiable.
- WebGL2 fallback is out of scope for the upgrade phases (WebGPU-only demo).
