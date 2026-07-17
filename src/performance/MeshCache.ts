/**
 * MeshCache.ts — GPU mesh cache with LRU eviction.
 *
 * The renderer uploads chunk meshes to GPU buffers and keeps them in a Map.
 * For large worlds that Map grows unbounded and leaks GPU memory. This cache
 * caps the number of resident GPU meshes and evicts the least-recently-used
 * entries when the cap is exceeded.
 *
 * `get`/`has` are hot-path methods called every frame for every visible
 * chunk; they perform no allocations and only touch a Map + a frame counter.
 *
 * Eviction is explicit (`evict(currentFrame)`) so the caller controls when
 * GPU buffers are destroyed (once per frame, after the render pass). Destroyed
 * buffers are removed from the cache and their keys freed.
 */

/** A cached GPU mesh: the buffers the renderer binds per chunk. */
export interface CachedMesh {
  /** Vertex buffer (interleaved layout owned by the mesher). */
  readonly vertexBuffer: GPUBuffer;
  /** Index buffer (uint16 or uint32, per `indexFormat`). */
  readonly indexBuffer: GPUBuffer;
  /** Index format matching the mesher's output. */
  readonly indexFormat: GPUIndexFormat;
  /** Number of opaque indices to draw. */
  readonly opaqueCount: number;
  /** Number of transparent indices to draw. */
  readonly transparentCount: number;
  /** Frame number this mesh was last used (touched by `get`/`set`). */
  lastUsed: number;
}

/** Default maximum number of resident GPU meshes. */
const DEFAULT_MAX_MESHES = 512;

/**
 * LRU cache of GPU chunk meshes. Thread-unsafe (single-threaded renderer use).
 *
 * The cache tracks the last frame each entry was touched. `evict` removes
 * entries whose `lastUsed` is oldest until `size <= maxMeshes`, destroying
 * their GPU buffers in the process.
 */
export class MeshCache {
  private readonly device: GPUDevice;
  private readonly maxMeshes: number;
  private readonly entries = new Map<string, CachedMesh>();

  /**
   * @param device    WebGPU device (used only for type plumbing; buffer
   *                  destruction is via `GPUBuffer.destroy()`).
   * @param maxMeshes Maximum resident meshes before LRU eviction kicks in.
   */
  constructor(device: GPUDevice, maxMeshes: number = DEFAULT_MAX_MESHES) {
    this.device = device;
    this.maxMeshes = maxMeshes;
  }

  /**
   * Look up a cached mesh and mark it as used this frame.
   *
   * Hot path: no allocations, one Map lookup + one field write.
   *
   * @param key      Chunk key (e.g. `"x,y,z"`).
   * @param frame    Current frame number, stamped onto `lastUsed`.
   * @returns The cached mesh, or `null` if absent.
   */
  get(key: string, frame: number = 0): CachedMesh | null {
    const entry = this.entries.get(key);
    if (entry === undefined) return null;
    entry.lastUsed = frame;
    return entry;
  }

  /**
   * Insert (or replace) a cached mesh. If the key already exists the old
   * buffers are destroyed before being overwritten. The new entry's
   * `lastUsed` is set to `frame`.
   */
  set(key: string, mesh: CachedMesh, frame: number = 0): void {
    const existing = this.entries.get(key);
    if (existing !== undefined) {
      existing.vertexBuffer.destroy();
      existing.indexBuffer.destroy();
    }
    mesh.lastUsed = frame;
    this.entries.set(key, mesh);
  }

  /** Whether a mesh is resident for `key`. Does not update `lastUsed`. */
  has(key: string): boolean {
    return this.entries.has(key);
  }

  /**
   * Remove and destroy a single mesh. No-op if absent.
   */
  delete(key: string): void {
    const entry = this.entries.get(key);
    if (entry === undefined) return;
    entry.vertexBuffer.destroy();
    entry.indexBuffer.destroy();
    this.entries.delete(key);
  }

  /**
   * Evict least-recently-used meshes until `size <= maxMeshes`.
   *
   * Call once per frame after rendering. Entries are evicted in ascending
   * `lastUsed` order; ties broken by insertion order (Map iteration order).
   *
   * @param currentFrame Current frame number (unused for ordering but kept
   *                     for API symmetry / future age-based heuristics).
   * @returns Number of meshes evicted.
   */
  evict(currentFrame: number = 0): number {
    if (this.entries.size <= this.maxMeshes) return 0;
    // Collect entries with their lastUsed so we can sort by recency.
    // This allocates only when eviction is actually needed (rare: once the
    // cache is warm, eviction happens at most once per frame and only when
    // new chunks stream in).
    const sorted = Array.from(this.entries) as [string, CachedMesh][];
    sorted.sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    const toEvict = this.entries.size - this.maxMeshes;
    let evicted = 0;
    for (let i = 0; i < toEvict && i < sorted.length; i++) {
      const [key, entry] = sorted[i]!;
      // Skip entries touched this frame (still in view).
      if (entry.lastUsed >= currentFrame) continue;
      entry.vertexBuffer.destroy();
      entry.indexBuffer.destroy();
      this.entries.delete(key);
      evicted++;
    }
    return evicted;
  }

  /** Current number of resident meshes. */
  get size(): number {
    return this.entries.size;
  }

  /** Remove and destroy all meshes. */
  clear(): void {
    for (const entry of this.entries.values()) {
      entry.vertexBuffer.destroy();
      entry.indexBuffer.destroy();
    }
    this.entries.clear();
  }

  /** Exposed for tests: the configured device. */
  protected getDevice(): GPUDevice {
    return this.device;
  }
}
