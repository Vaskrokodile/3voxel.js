/**
 * GreedyMesher.ts — classic greedy meshing per axis with baked vertex AO.
 *
 * Algorithm (per chunk):
 *   For each of 3 axes d, sweep slice boundaries i in [0..CHUNK_SIZE]:
 *     - Build a CHUNK_SIZE×CHUNK_SIZE mask of visible faces in the slice plane.
 *     - A face is visible when its owner block is a 'cube' solid and the
 *       neighbor across the boundary does not occlude (`opaqueFaces` false).
 *     - Greedily merge adjacent mask cells with identical (blockId, face sign,
 *       4-corner AO) into one quad, then emit 4 vertices + 2 triangles.
 *   Opaque owner faces are emitted first; transparent owner faces second, so
 *       the index buffer is laid out opaque-then-transparent.
 *
 * Edge voxels use the NeighborSampler (world-space) so faces between chunks
 * are culled when the neighbor is opaque. In-worker meshing passes AIR for
 * out-of-chunk neighbors (see chunkWorker.ts) — border re-meshing is a
 * main-thread concern.
 *
 * 'cross' meshType blocks (plants) are NOT meshed here (TODO stub).
 *
 * Performance: mask arrays are allocated once per mesher and reused across
 * slices/axes/chunks; no per-voxel allocations. Additional optimizations:
 *   - Early exit: a chunk reporting `isEmpty()` skips meshing entirely.
 *   - Border-air fast path: when a chunk's face perpendicular to an axis is
 *     entirely AIR, out-of-chunk neighbor lookups along that axis are skipped
 *     (treated as AIR), avoiding expensive world sampler calls common for
 *     chunks floating above terrain.
 */

import { AIR, CHUNK_SIZE } from '../core/types.js';
import type { BlockId, ChunkCoord, ChunkMeshData } from '../core/types.js';
import { vertexAO } from './ao.js';
import { MeshBuilder } from './MeshBuilder.js';
import type { BlockRegistryLike, BlockTypeLike, NeighborSampler, VoxelChunkLike } from './types.js';

/** Fallback block type for AIR / unknown ids. */
const AIR_TYPE: Readonly<BlockTypeLike> = {
  id: AIR,
  name: 'air',
  solid: false,
  transparent: false,
  opaqueFaces: false,
  meshType: 'none',
};

/** Plane-axis pairs for each sweep axis d. u and v are the in-plane axes. */
const PLANE_AXES: readonly [readonly [number, number], readonly [number, number], readonly [number, number]] = [
  [1, 2], // d=0 (x): u=y, v=z
  [0, 2], // d=1 (y): u=x, v=z
  [0, 1], // d=2 (z): u=x, v=y
];

/** Map (d-axis coord a, u-axis coord b, v-axis coord c) -> [x,y,z]. */
function unpack(d: number, a: number, b: number, c: number): readonly [number, number, number] {
  if (d === 0) return [a, b, c];
  if (d === 1) return [b, a, c];
  return [b, c, a];
}

interface Origin {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export class GreedyMesher {
  private readonly registry: BlockRegistryLike;

  // Reusable mask buffers (sized CHUNK_SIZE*CHUNK_SIZE). Allocated once.
  private readonly maskBlock: Int32Array;
  private readonly maskSign: Int8Array;
  private readonly maskTransparent: Int8Array;
  private readonly maskAO: Int8Array; // length N*4

  constructor(registry: BlockRegistryLike) {
    this.registry = registry;
    const n = CHUNK_SIZE * CHUNK_SIZE;
    this.maskBlock = new Int32Array(n);
    this.maskSign = new Int8Array(n);
    this.maskTransparent = new Int8Array(n);
    this.maskAO = new Int8Array(n * 4);
  }

  mesh(chunk: VoxelChunkLike, worldOrigin: Origin, sampler: NeighborSampler): ChunkMeshData {
    const registry = this.registry;
    const size = CHUNK_SIZE;
    const ox = worldOrigin.x;
    const oy = worldOrigin.y;
    const oz = worldOrigin.z;

    const typeOf = (id: BlockId): Readonly<BlockTypeLike> => registry.get(id) ?? AIR_TYPE;

    // Early exit: if the chunk reports itself as entirely AIR (palette-backed
    // chunks answer this in O(1)), skip meshing altogether.
    if (chunk.isEmpty?.() === true) {
      return this.emptyMesh(chunk.coord);
    }

    // Per-axis border-air detection. For each sweep axis d, check whether the
    // two chunk faces perpendicular to d (local d-coord 0 and size-1) are
    // entirely AIR. When true, no solid block touches that chunk boundary, so
    // out-of-chunk neighbors along d can be treated as AIR without consulting
    // the (potentially expensive) world sampler. Faces between chunks are
    // always owned by the chunk whose border is solid, so this never drops a
    // visible face — it only skips sampler calls that would have returned AIR
    // (or a solid neighbor whose exposed face is the neighbor's responsibility).
    const borderAir0 = this.axisBorderIsAir(0, chunk, size);
    const borderAir1 = this.axisBorderIsAir(1, chunk, size);
    const borderAir2 = this.axisBorderIsAir(2, chunk, size);

    // Full world-space sampler (used when the border is NOT all air).
    const sampleFull = (lx: number, ly: number, lz: number): BlockId => {
      if (
        lx >= 0 && lx < size &&
        ly >= 0 && ly < size &&
        lz >= 0 && lz < size
      ) {
        return chunk.getBlock(lx, ly, lz);
      }
      return sampler(ox + lx, oy + ly, oz + lz);
    };

    // Fast sampler: returns AIR for any out-of-chunk coordinate (no world
    // lookup). Used per-axis when that axis's border is all air.
    const sampleAir = (lx: number, ly: number, lz: number): BlockId => {
      if (
        lx >= 0 && lx < size &&
        ly >= 0 && ly < size &&
        lz >= 0 && lz < size
      ) {
        return chunk.getBlock(lx, ly, lz);
      }
      return AIR;
    };

    // AO occlusion test: a block occludes a vertex if it is opaque on faces.
    const occludes = (id: BlockId): boolean => typeOf(id).opaqueFaces;

    const builder = new MeshBuilder();

    // Select the per-axis sample function once per axis (no per-slice branch).
    const axisSamples: ReadonlyArray<(lx: number, ly: number, lz: number) => BlockId> = [
      borderAir0 ? sampleAir : sampleFull,
      borderAir1 ? sampleAir : sampleFull,
      borderAir2 ? sampleAir : sampleFull,
    ];

    for (let d = 0; d < 3; d++) {
      const sample = axisSamples[d]!;
      for (let i = 0; i <= size; i++) {
        this.buildMask(d, i, size, sample, typeOf, occludes);
        // Pass 1: emit opaque owner quads; pass 2: emit transparent owner quads.
        this.mergeAndEmit(d, i, size, worldOrigin, /*transparentPhase*/ false, builder);
        this.mergeAndEmit(d, i, size, worldOrigin, /*transparentPhase*/ true, builder);
      }
    }

    const built = builder.build();
    const coord: ChunkCoord = chunk.coord;
    return {
      chunk: coord,
      vertices: built.vertices,
      indices: built.indices,
      indexFormat: built.indexFormat,
      vertexCount: built.vertexCount,
      indexCount: built.indexCount,
      opaqueIndexCount: builder.getOpaqueIndexCount(),
      transparentIndexCount: builder.getTransparentIndexCount(),
    };
  }

  /**
   * Build an empty (zero-vertex, zero-index) mesh result for a chunk that
   * needs no geometry (e.g. entirely AIR).
   */
  private emptyMesh(coord: ChunkCoord): ChunkMeshData {
    return {
      chunk: coord,
      vertices: new Uint8Array(0),
      indices: new Uint8Array(0),
      indexFormat: 'uint16',
      vertexCount: 0,
      indexCount: 0,
      opaqueIndexCount: 0,
      transparentIndexCount: 0,
    };
  }

  /**
   * Check whether both chunk faces perpendicular to axis `d` (local d-coord 0
   * and size-1) are entirely AIR. Used to skip out-of-chunk sampler calls for
   * that axis. O(2 * size^2) getBlock calls, done once per mesh.
   */
  private axisBorderIsAir(d: number, chunk: VoxelChunkLike, size: number): boolean {
    // Face at d-coord 0 and d-coord size-1. Iterate over the in-plane axes.
    const plane = PLANE_AXES[d]!;
    const uAxis = plane[0]!;
    const vAxis = plane[1]!;
    for (let face = 0; face < 2; face++) {
      const dCoord = face === 0 ? 0 : size - 1;
      for (let cv = 0; cv < size; cv++) {
        for (let cu = 0; cu < size; cu++) {
          const xyz = unpack(d, dCoord, cu, cv);
          if (chunk.getBlock(xyz[0], xyz[1], xyz[2]) !== AIR) return false;
        }
      }
    }
    // Suppress unused-var lint for uAxis/vAxis (kept for clarity of the plane).
    void uAxis;
    void vAxis;
    return true;
  }

  /**
   * Fill the reusable mask for slice boundary `i` on axis `d`.
   * For each plane cell (cu,cv) we record the owning block id, face sign
   * (+1 / -1 / 0=none), transparent flag, and 4 corner AO values.
   */
  private buildMask(
    d: number,
    i: number,
    size: number,
    sample: (lx: number, ly: number, lz: number) => BlockId,
    typeOf: (id: BlockId) => Readonly<BlockTypeLike>,
    occludes: (id: BlockId) => boolean,
  ): void {
    const maskBlock = this.maskBlock;
    const maskSign = this.maskSign;
    const maskTransparent = this.maskTransparent;
    const maskAO = this.maskAO;

    for (let cv = 0; cv < size; cv++) {
      for (let cu = 0; cu < size; cu++) {
        const cellIdx = cu + cv * size;

        // Blocks on either side of the slice boundary along axis d.
        const backXYZ = unpack(d, i - 1, cu, cv);
        const frontXYZ = unpack(d, i, cu, cv);
        const backBlock = sample(backXYZ[0], backXYZ[1], backXYZ[2]);
        const frontBlock = sample(frontXYZ[0], frontXYZ[1], frontXYZ[2]);
        const backType = typeOf(backBlock);
        const frontType = typeOf(frontBlock);

        let ownerBlock: BlockId = AIR;
        let sign = 0;
        let ownerIsTransparent = false;

        // Positive face: owner is the back block, exposed toward +d.
        if (
          backType.meshType === 'cube' &&
          backType.solid &&
          !frontType.opaqueFaces &&
          !(backType.transparent && frontBlock === backBlock)
        ) {
          ownerBlock = backBlock;
          sign = 1;
          ownerIsTransparent = backType.transparent;
        }
        // Negative face: owner is the front block, exposed toward -d.
        else if (
          frontType.meshType === 'cube' &&
          frontType.solid &&
          !backType.opaqueFaces &&
          !(frontType.transparent && frontBlock === backBlock)
        ) {
          ownerBlock = frontBlock;
          sign = -1;
          ownerIsTransparent = frontType.transparent;
        }

        maskBlock[cellIdx] = ownerBlock;
        maskSign[cellIdx] = sign;
        maskTransparent[cellIdx] = ownerIsTransparent ? 1 : 0;

        if (sign === 0) {
          continue;
        }

        // Owner d-coord: back block lives at i-1 (sign +1), front at i (sign -1).
        const ownerD = sign === 1 ? i - 1 : i;
        // Occluder layer is one step along the face normal from the owner.
        const occD = ownerD + sign;

        // Compute AO at the 4 corners (du,dv) in {0,1}^2.
        for (let dv = 0; dv < 2; dv++) {
          for (let du = 0; du < 2; du++) {
            const uDir = du === 0 ? -1 : 1;
            const vDir = dv === 0 ? -1 : 1;

            const side1XYZ = unpack(d, occD, cu + uDir, cv);
            const side2XYZ = unpack(d, occD, cu, cv + vDir);
            const cornerXYZ = unpack(d, occD, cu + uDir, cv + vDir);

            const side1 = sample(side1XYZ[0], side1XYZ[1], side1XYZ[2]);
            const side2 = sample(side2XYZ[0], side2XYZ[1], side2XYZ[2]);
            const corner = sample(cornerXYZ[0], cornerXYZ[1], cornerXYZ[2]);

            const ao = vertexAO(side1, side2, corner, occludes);
            maskAO[cellIdx * 4 + (du + dv * 2)] = ao;
          }
        }
      }
    }
  }

  /**
   * Greedily merge mask cells of the requested bucket into quads and emit
   * them. Cells consumed in pass 1 (opaque) are zeroed; pass 2 then merges
   * the remaining (transparent) cells.
   */
  private mergeAndEmit(
    d: number,
    i: number,
    size: number,
    worldOrigin: Origin,
    transparentPhase: boolean,
    builder: MeshBuilder,
  ): void {
    const maskBlock = this.maskBlock;
    const maskSign = this.maskSign;
    const maskTransparent = this.maskTransparent;
    const maskAO = this.maskAO;

    const sameMask = (a: number, b: number): boolean => {
      if (maskSign[a] === 0 || maskSign[b] === 0) return false;
      if (maskBlock[a] !== maskBlock[b]) return false;
      if (maskSign[a] !== maskSign[b]) return false;
      const aoA = a * 4;
      const aoB = b * 4;
      return (
        maskAO[aoA] === maskAO[aoB] &&
        maskAO[aoA + 1] === maskAO[aoB + 1] &&
        maskAO[aoA + 2] === maskAO[aoB + 2] &&
        maskAO[aoA + 3] === maskAO[aoB + 3]
      );
    };

    const originArr: readonly [number, number, number] = [worldOrigin.x, worldOrigin.y, worldOrigin.z];

    for (let cv = 0; cv < size; cv++) {
      for (let cu = 0; cu < size; ) {
        const idx = cu + cv * size;
        if (maskSign[idx] === 0) {
          cu++;
          continue;
        }
        // Skip cells not belonging to the current bucket.
        const isTransparent = maskTransparent[idx] === 1;
        if (isTransparent !== transparentPhase) {
          cu++;
          continue;
        }

        const sign = maskSign[idx] ?? 0;
        const blockId = maskBlock[idx] ?? AIR;
        const ao00 = maskAO[idx * 4] ?? 0;
        const ao10 = maskAO[idx * 4 + 1] ?? 0;
        const ao01 = maskAO[idx * 4 + 2] ?? 0;
        const ao11 = maskAO[idx * 4 + 3] ?? 0;

        // Width along u.
        let w = 1;
        while (cu + w < size && sameMask(idx, idx + w)) w++;

        // Height along v.
        let h = 1;
        while (cv + h < size) {
          let ok = true;
          for (let k = 0; k < w; k++) {
            if (!sameMask(idx, cu + k + (cv + h) * size)) {
              ok = false;
              break;
            }
          }
          if (!ok) break;
          h++;
        }

        this.emitQuad(
          d,
          i,
          cu,
          cv,
          w,
          h,
          sign,
          blockId,
          ao00,
          ao10,
          ao01,
          ao11,
          originArr,
          builder,
          transparentPhase,
        );

        // Mark consumed.
        for (let dv = 0; dv < h; dv++) {
          for (let du = 0; du < w; du++) {
            maskSign[(cu + du) + (cv + dv) * size] = 0;
          }
        }
        cu += w;
      }
    }
  }

  private emitQuad(
    d: number,
    i: number,
    u0: number,
    v0: number,
    w: number,
    h: number,
    sign: number,
    blockId: BlockId,
    ao00: number,
    ao10: number,
    ao01: number,
    ao11: number,
    origin: readonly [number, number, number],
    builder: MeshBuilder,
    transparent: boolean,
  ): void {
    // Face plane coordinate along d (world).
    const plane = PLANE_AXES[d] ?? [0, 0];
    const uAxis = plane[0] ?? 0;
    const vAxis = plane[1] ?? 0;
    const dWorld = (origin[d] ?? 0) + i;
    const uWorld0 = (origin[uAxis] ?? 0) + u0;
    const vWorld0 = (origin[vAxis] ?? 0) + v0;

    // 4 corner world positions: (du,dv) in {0,1}^2.
    const p00 = unpack(d, dWorld, uWorld0, vWorld0);
    const p10 = unpack(d, dWorld, uWorld0 + w, vWorld0);
    const p01 = unpack(d, dWorld, uWorld0, vWorld0 + h);
    const p11 = unpack(d, dWorld, uWorld0 + w, vWorld0 + h);

    const normal = unpack(d, sign, 0, 0);

    // UV in voxel units so textures tile per-voxel across the merged quad.
    const uv00: readonly [number, number] = [u0, v0];
    const uv10: readonly [number, number] = [u0 + w, v0];
    const uv01: readonly [number, number] = [u0, v0 + h];
    const uv11: readonly [number, number] = [u0 + w, v0 + h];

    // Corner table: index -> (pos, ao, uv) for (0,0),(1,0),(0,1),(1,1).
    const corners: readonly {
      readonly pos: readonly [number, number, number];
      readonly ao: number;
      readonly uv: readonly [number, number];
    }[] = [
      { pos: p00, ao: ao00, uv: uv00 },
      { pos: p10, ao: ao10, uv: uv10 },
      { pos: p01, ao: ao01, uv: uv01 },
      { pos: p11, ao: ao11, uv: uv11 },
    ];

    // Vertex order chosen so the two triangles have consistent winding
    // per face sign. (0,1,2,3) = p00,p10,p11,p01 for + faces; reversed for -.
    const order = sign === 1 ? [0, 1, 3, 2] : [0, 2, 3, 1];

    const c0 = corners[order[0] ?? 0]!;
    const c1 = corners[order[1] ?? 0]!;
    const c2 = corners[order[2] ?? 0]!;
    const c3 = corners[order[3] ?? 0]!;

    const v0i = builder.addVertex(c0.pos, normal, c0.ao, blockId, c0.uv);
    const v1i = builder.addVertex(c1.pos, normal, c1.ao, blockId, c1.uv);
    const v2i = builder.addVertex(c2.pos, normal, c2.ao, blockId, c2.uv);
    const v3i = builder.addVertex(c3.pos, normal, c3.ao, blockId, c3.uv);

    builder.addTriangle(v0i, v1i, v2i, transparent);
    builder.addTriangle(v0i, v2i, v3i, transparent);
  }
}
