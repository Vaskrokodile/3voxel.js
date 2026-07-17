/**
 * WebGPU compute-based indirect-draw frustum culling.
 *
 * This is tdjs's differentiator vs. three.js: instead of CPU-culling chunks
 * and rebuilding draw calls each frame, a compute shader tests every chunk
 * AABB against the camera frustum and writes a per-chunk
 * `drawIndexedIndirect` command into a storage buffer. Culled chunks get a
 * zeroed command (indexCount = 0 → no-op draw). The renderer then issues one
 * `drawIndexedIndirect` per chunk, reading from the output buffer.
 *
 * ## Buffer layouts (must match the WGSL structs below exactly)
 *
 * ### Input chunk storage buffer (`chunks`)
 * Stride per chunk: **48 bytes** (12 floats / uint32s).
 *
 * | offset | field          | type  |
 * |--------|----------------|-------|
 * |   0    | min.x          | f32   |
 * |   4    | min.y          | f32   |
 * |   8    | min.z          | f32   |
 * |  12    | _pad           | f32   |
 * |  16    | max.x          | f32   |
 * |  20    | max.y          | f32   |
 * |  24    | max.z          | f32   |
 * |  28    | indexCount     | u32   |
 * |  32    | instanceCount  | u32   |
 * |  36    | firstIndex     | u32   |
 * |  40    | vertexOffset   | u32   |
 * |  44    | firstInstance  | u32   |
 *
 * Total buffer size = `maxChunks * 48`.
 *
 * ### Output indirect-draw storage buffer (`outCmds`)
 * Stride per chunk: **20 bytes** (5 uint32s) — matches WebGPU
 * `GPUIndirectDrawData`:
 *
 * | offset | field          | type |
 * |--------|----------------|------|
 * |   0    | indexCount     | u32  |
 * |   4    | instanceCount  | u32  |
 * |   8    | firstIndex     | u32  |
 * |  12    | vertexOffset   | u32  |
 * |  16    | firstInstance  | u32  |
 *
 * Total buffer size = `maxChunks * 20`.
 * The renderer calls `renderPass.drawIndexedIndirect(outCmds, chunkIndex * 20)`.
 *
 * ### Uniform buffer (`FrustumUniform`)
 * Size: **176 bytes** (44 float32 slots).
 *
 * | offset | field          | type              |
 * |--------|----------------|-------------------|
 * |   0    | planes[0..5]   | 6 × vec4<f32>     |  96 bytes
 * |  96    | viewProj       | mat4x4<f32>       |  64 bytes
 * | 160    | chunkCount     | u32               |   4 bytes
 * | 164    | _pad           | 3 × u32           |  12 bytes
 *
 * Frustum planes are stored as `(a, b, c, w)` where a point `p` is inside the
 * frustum when `dot(plane.xyz, p) + plane.w >= 0` for all 6 planes. Planes are
 * normalized (unit normal). Extracted on CPU via {@link extractFrustumPlanes}.
 */
import type { AABB, Mat4 } from '../core/types.js';

/** Arguments for one WebGPU indirect indexed draw (5 uint32s). */
export interface IndirectDrawArgs {
  readonly indexCount: number;
  readonly instanceCount: number;
  readonly firstIndex: number;
  readonly vertexOffset: number;
  readonly firstInstance: number;
}

/** A chunk's AABB paired with its draw args, for {@link GPUCuller.writeChunkData}. */
export interface GPUChunkData {
  readonly aabb: AABB;
  readonly draw: IndirectDrawArgs;
}

// ---------------------------------------------------------------------------
// Layout constants — keep in sync with the WGSL structs and the table above.
// ---------------------------------------------------------------------------

/** Bytes per chunk in the input storage buffer. */
export const CHUNK_BUFFER_STRIDE = 48;
/** Bytes per draw command in the output indirect buffer. */
export const DRAW_BUFFER_STRIDE = 20;
/** Bytes of the frustum uniform buffer. */
export const FRUSTUM_UNIFORM_SIZE = 176;
/** Float32 slots in the frustum uniform (176 / 4). */
const FRUSTUM_UNIFORM_FLOATS = 44;

/** Workgroup size for the cull compute shader. */
const WORKGROUP_SIZE = 64;

/**
 * WebGPU `GPUBufferUsage` flag values (standardized by the WebGPU spec).
 * Defined as numeric constants so the code does not depend on the
 * `GPUBufferUsage` global being present at runtime (it is a type-only
 * declaration from `@webgpu/types` and is absent in Node/test environments).
 */
export const BUFFER_USAGE = {
  STORAGE: 0x80,
  COPY_DST: 0x08,
  INDIRECT: 0x100,
  UNIFORM: 0x40,
} as const;

/**
 * WGSL source for the cull compute shader.
 *
 * Each invocation handles one chunk. It tests the chunk AABB's 8 corners
 * against the 6 frustum planes. If all 8 corners are outside any single
 * plane the chunk is culled (zeroed draw command); otherwise the original
 * draw args are forwarded.
 */
export const CULL_WGSL = /* wgsl */ `
struct FrustumUniform {
  planes   : array<vec4<f32>, 6>,
  viewProj : mat4x4<f32>,
  chunkCount : u32,
};

struct ChunkIn {
  min           : vec3<f32>,
  max           : vec3<f32>,
  indexCount    : u32,
  instanceCount : u32,
  firstIndex    : u32,
  vertexOffset  : u32,
  firstInstance : u32,
};

struct DrawCmd {
  indexCount    : u32,
  instanceCount : u32,
  firstIndex    : u32,
  vertexOffset  : u32,
  firstInstance : u32,
};

@group(0) @binding(0) var<uniform>  u      : FrustumUniform;
@group(0) @binding(1) var<storage, read>         chunks  : array<ChunkIn>;
@group(0) @binding(2) var<storage, read_write>   outCmds : array<DrawCmd>;

@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let idx = gid.x;
  if (idx >= u.chunkCount) {
    return;
  }

  let c = chunks[idx];

  // 8 AABB corners.
  var corners : array<vec3<f32>, 8>;
  corners[0] = c.min;
  corners[1] = vec3<f32>(c.max.x, c.min.y, c.min.z);
  corners[2] = vec3<f32>(c.min.x, c.max.y, c.min.z);
  corners[3] = vec3<f32>(c.max.x, c.max.y, c.min.z);
  corners[4] = vec3<f32>(c.min.x, c.min.y, c.max.z);
  corners[5] = vec3<f32>(c.max.x, c.min.y, c.max.z);
  corners[6] = vec3<f32>(c.min.x, c.max.y, c.max.z);
  corners[7] = c.max;

  var visible = true;
  for (var p = 0u; p < 6u; p = p + 1u) {
    var outside = 0u;
    for (var i = 0u; i < 8u; i = i + 1u) {
      let d = dot(u.planes[p].xyz, corners[i]) + u.planes[p].w;
      if (d < 0.0) {
        outside = outside + 1u;
      }
    }
    if (outside >= 8u) {
      visible = false;
      break;
    }
  }

  if (visible) {
    outCmds[idx].indexCount    = c.indexCount;
    outCmds[idx].instanceCount = c.instanceCount;
    outCmds[idx].firstIndex    = c.firstIndex;
    outCmds[idx].vertexOffset  = c.vertexOffset;
    outCmds[idx].firstInstance = c.firstInstance;
  } else {
    outCmds[idx].indexCount    = 0u;
    outCmds[idx].instanceCount = 0u;
    outCmds[idx].firstIndex    = 0u;
    outCmds[idx].vertexOffset  = 0u;
    outCmds[idx].firstInstance = 0u;
  }
}
`;

/**
 * Extract the 6 frustum planes from a column-major view-projection matrix.
 *
 * Returns 24 floats: 6 planes of `(a, b, c, w)` where a point `p` is inside
 * the frustum when `dot((a,b,c), p) + w >= 0` for every plane. Each plane's
 * normal `(a,b,c)` is normalized to unit length (with `w` scaled to match).
 *
 * The matrix is column-major (WebGPU convention) with NDC z in [0,1].
 * Row `i` of the logical matrix is `(m[i], m[i+4], m[i+8], m[i+12])`.
 *
 * Plane derivation (Gribb-Hartmann, adapted for WebGPU [0,1] z):
 *  - left:   row4 + row1
 *  - right:  row4 - row1
 *  - bottom: row4 + row2
 *  - top:    row4 - row2
 *  - near:   row3          (z >= 0 in WebGPU NDC)
 *  - far:    row4 - row3
 *
 * @returns A `Float32Array` of length 24 (6 planes × 4 components).
 */
export function extractFrustumPlanes(viewProj: Mat4): Float32Array {
  const m = viewProj.m;

  // Logical rows of the column-major matrix.
  const r1x = m[0]!,  r1y = m[4]!,  r1z = m[8]!,  r1w = m[12]!;
  const r2x = m[1]!,  r2y = m[5]!,  r2z = m[9]!,  r2w = m[13]!;
  const r3x = m[2]!,  r3y = m[6]!,  r3z = m[10]!, r3w = m[14]!;
  const r4x = m[3]!,  r4y = m[7]!,  r4z = m[11]!, r4w = m[15]!;

  const planes = new Float32Array(24);

  // Helper: write a plane, normalize, and flip sign so that "inside" = >= 0.
  // The raw inequalities give "inside" as >= 0 already for left/right/bottom/
  // top/far; near (row3) gives zc >= 0 which is also >= 0. So no flip needed.
  const write = (slot: number, a: number, b: number, c: number, d: number): void => {
    const len = Math.hypot(a, b, c);
    const inv = len > 1e-12 ? 1 / len : 0;
    planes[slot * 4 + 0] = a * inv;
    planes[slot * 4 + 1] = b * inv;
    planes[slot * 4 + 2] = c * inv;
    planes[slot * 4 + 3] = d * inv;
  };

  // left:   row4 + row1
  write(0, r4x + r1x, r4y + r1y, r4z + r1z, r4w + r1w);
  // right:  row4 - row1
  write(1, r4x - r1x, r4y - r1y, r4z - r1z, r4w - r1w);
  // bottom: row4 + row2
  write(2, r4x + r2x, r4y + r2y, r4z + r2z, r4w + r2w);
  // top:    row4 - row2
  write(3, r4x - r2x, r4y - r2y, r4z - r2z, r4w - r2w);
  // near:   row3 (WebGPU z in [0,1] → zc >= 0)
  write(4, r3x, r3y, r3z, r3w);
  // far:    row4 - row3
  write(5, r4x - r3x, r4y - r3y, r4z - r3z, r4w - r3w);

  return planes;
}

/**
 * WebGPU compute-based chunk culler.
 *
 * Created once (with a fixed `maxChunks` capacity); call {@link writeChunkData}
 * when chunk meshes change and {@link cull} every frame to produce the
 * indirect-draw buffer for the renderer.
 */
export class GPUCuller {
  private readonly device: GPUDevice;
  private readonly maxChunks: number;

  private readonly inputBuffer: GPUBuffer;
  private readonly outputBuffer: GPUBuffer;
  private readonly uniformBuffer: GPUBuffer;
  private readonly pipeline: GPUComputePipeline;
  private readonly bindGroup: GPUBindGroup;

  /** CPU-side staging mirror of the input chunk buffer. */
  private readonly chunkStaging: ArrayBuffer;
  private readonly chunkFloats: Float32Array<ArrayBuffer>;
  private readonly chunkUints: Uint32Array<ArrayBuffer>;

  /** CPU-side staging for the uniform buffer. */
  private readonly uniformStaging: Float32Array<ArrayBuffer>;

  /** Number of valid chunks written by the last {@link writeChunkData}. */
  private chunkCount = 0;

  /**
   * @param device    A WebGPU device.
   * @param maxChunks Maximum number of chunks the buffers can hold.
   */
  constructor(device: GPUDevice, maxChunks: number) {
    if (maxChunks <= 0) throw new RangeError('maxChunks must be > 0');
    this.device = device;
    this.maxChunks = maxChunks;

    const inputSize = maxChunks * CHUNK_BUFFER_STRIDE;
    const outputSize = maxChunks * DRAW_BUFFER_STRIDE;

    this.inputBuffer = device.createBuffer({
      label: 'tdjs.cull.input',
      size: inputSize,
      usage: BUFFER_USAGE.STORAGE | BUFFER_USAGE.COPY_DST,
    });

    this.outputBuffer = device.createBuffer({
      label: 'tdjs.cull.output',
      size: outputSize,
      usage: BUFFER_USAGE.STORAGE | BUFFER_USAGE.INDIRECT,
    });

    this.uniformBuffer = device.createBuffer({
      label: 'tdjs.cull.uniform',
      size: FRUSTUM_UNIFORM_SIZE,
      usage: BUFFER_USAGE.UNIFORM | BUFFER_USAGE.COPY_DST,
    });

    const shader = device.createShaderModule({ code: CULL_WGSL });

    this.pipeline = device.createComputePipeline({
      label: 'tdjs.cull.pipeline',
      layout: 'auto',
      compute: { module: shader, entryPoint: 'main' },
    });

    const bindGroupLayout = this.pipeline.getBindGroupLayout(0);
    this.bindGroup = device.createBindGroup({
      label: 'tdjs.cull.bindGroup',
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: { buffer: this.inputBuffer } },
        { binding: 2, resource: { buffer: this.outputBuffer } },
      ],
    });

    this.chunkStaging = new ArrayBuffer(inputSize);
    this.chunkFloats = new Float32Array(this.chunkStaging);
    this.chunkUints = new Uint32Array(this.chunkStaging);

    this.uniformStaging = new Float32Array(FRUSTUM_UNIFORM_FLOATS);
  }

  /** Maximum chunk capacity. */
  get capacity(): number {
    return this.maxChunks;
  }

  /** Number of valid chunks from the last {@link writeChunkData}. */
  get count(): number {
    return this.chunkCount;
  }

  /** The output indirect-draw buffer (read by the renderer). */
  get indirectBuffer(): GPUBuffer {
    return this.outputBuffer;
  }

  /** Stride (bytes) between draw commands in the output buffer. */
  get indirectStride(): number {
    return DRAW_BUFFER_STRIDE;
  }

  /**
   * Upload chunk AABB + draw-arg data to the input storage buffer.
   *
   * @param chunks Up to `maxChunks` entries. Extra entries throw.
   */
  writeChunkData(chunks: GPUChunkData[]): void {
    if (chunks.length > this.maxChunks) {
      throw new RangeError(
        `writeChunkData: ${chunks.length} chunks exceed capacity ${this.maxChunks}`,
      );
    }

    // Zero the used region so stale data doesn't leak.
    this.chunkFloats.fill(0, 0, this.maxChunks * (CHUNK_BUFFER_STRIDE / 4));

    for (let i = 0; i < chunks.length; i++) {
      const ch = chunks[i]!;
      const base = i * (CHUNK_BUFFER_STRIDE / 4); // 12 float32 slots

      // min (vec3 + pad)
      this.chunkFloats[base + 0] = ch.aabb.min.x;
      this.chunkFloats[base + 1] = ch.aabb.min.y;
      this.chunkFloats[base + 2] = ch.aabb.min.z;
      // base + 3 = pad (already 0)

      // max (vec3)
      this.chunkFloats[base + 4] = ch.aabb.max.x;
      this.chunkFloats[base + 5] = ch.aabb.max.y;
      this.chunkFloats[base + 6] = ch.aabb.max.z;

      // draw args (5 u32) — same byte slots, reinterpreted as uint32.
      this.chunkUints[base + 7] = ch.draw.indexCount;
      this.chunkUints[base + 8] = ch.draw.instanceCount;
      this.chunkUints[base + 9] = ch.draw.firstIndex;
      this.chunkUints[base + 10] = ch.draw.vertexOffset;
      this.chunkUints[base + 11] = ch.draw.firstInstance;
    }

    this.chunkCount = chunks.length;
    this.device.queue.writeBuffer(this.inputBuffer, 0, this.chunkFloats);
  }

  /**
   * Run the cull compute pass for the current chunk data and view-projection.
   *
   * Encodes the compute pass onto `commandEncoder`, uploads the frustum
   * uniform, and dispatches. Returns the output indirect-draw buffer; the
   * renderer issues `drawIndexedIndirect(buffer, chunkIndex * 20)` per chunk.
   *
   * @param viewProj         Column-major view-projection matrix.
   * @param commandEncoder   Encoder to record the compute pass onto.
   * @returns                The output indirect-draw storage buffer.
   */
  cull(viewProj: Mat4, commandEncoder: GPUCommandEncoder): GPUBuffer {
    // --- Build the uniform staging buffer -------------------------------
    const planes = extractFrustumPlanes(viewProj);
    this.uniformStaging.set(planes, 0); // slots 0..23
    this.uniformStaging.set(viewProj.m, 24); // slots 24..39
    this.uniformStaging[40] = this.chunkCount; // slot 40 = byte 160
    // slots 41..43 stay 0 (padding)

    this.device.queue.writeBuffer(
      this.uniformBuffer,
      0,
      this.uniformStaging,
    );

    // --- Dispatch ------------------------------------------------------
    const pass = commandEncoder.beginComputePass({ label: 'tdjs.cull.pass' });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    const workgroups = Math.ceil(this.chunkCount / WORKGROUP_SIZE);
    if (workgroups > 0) {
      pass.dispatchWorkgroups(workgroups);
    }
    pass.end();

    return this.outputBuffer;
  }

  /** Release GPU resources. */
  destroy(): void {
    this.inputBuffer.destroy();
    this.outputBuffer.destroy();
    this.uniformBuffer.destroy();
  }
}
