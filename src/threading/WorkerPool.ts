/**
 * WorkerPool.ts — manages N chunk workers and dispatches mesh requests.
 *
 * Usage (browser, with Vite):
 *   const url = new URL('./chunkWorker.ts', import.meta.url);
 *   const pool = new WorkerPool(url.href);
 * The pool takes a URL *string* (the caller constructs it) so the bundler can
 * statically analyze the worker import. For tests, pass `workerFactory` to
 * inject a fake worker implementation instead of spawning a real one.
 *
 * Dispatch is least-busy: each request goes to the worker with the fewest
 * pending requests. Pending count is tracked per worker and exposed via
 * `busy`. Worker errors reject the in-flight promise for that worker.
 *
 * All result ArrayBuffers arrive transferred (the worker detaches them); the
 * pool does not copy.
 */

import type { MeshRequest, MeshResult } from './messages.js';

/** Factory that creates a Worker. Injected in tests; defaults to `new Worker`. */
export type WorkerFactory = (url: string) => Worker;

interface PendingRequest {
  readonly resolve: (result: MeshResult) => void;
  readonly reject: (err: Error) => void;
}

interface WorkerHandle {
  readonly worker: Worker;
  /** Map of correlation id -> pending request, local to this worker. */
  readonly pending: Map<number, PendingRequest>;
  onError: ((err: Error) => void) | null;
}

const defaultWorkerFactory: WorkerFactory = (url: string) => {
  return new Worker(new URL(url), { type: 'module' });
};

export interface WorkerPoolOptions {
  /** Number of workers to spawn. Default: navigator.hardwareConcurrency || 4. */
  readonly size?: number;
  /** Inject a fake worker for tests. */
  readonly workerFactory?: WorkerFactory;
}

export class WorkerPool {
  private readonly handles: WorkerHandle[] = [];
  private readonly factory: WorkerFactory;
  private nextId = 1;

  constructor(workerUrl: string, options?: WorkerPoolOptions) {
    const size =
      options?.size ??
      (typeof navigator !== 'undefined' && navigator.hardwareConcurrency
        ? navigator.hardwareConcurrency
        : 4);
    this.factory = options?.workerFactory ?? defaultWorkerFactory;

    for (let i = 0; i < size; i++) {
      const worker = this.factory(workerUrl);
      const handle: WorkerHandle = { worker, pending: new Map(), onError: null };
      this.handles.push(handle);

      worker.onmessage = (ev: MessageEvent) => {
        const data = ev.data as MeshResult | undefined;
        if (data === undefined || data === null) return;
        const req = handle.pending.get(data.id);
        if (req === undefined) return;
        handle.pending.delete(data.id);
        req.resolve(data);
      };

      worker.onerror = (ev: ErrorEvent) => {
        const err = new Error(ev.message || 'worker error');
        // Reject all pending requests for this worker.
        for (const [, req] of handle.pending) {
          req.reject(err);
        }
        handle.pending.clear();
        if (handle.onError) handle.onError(err);
      };
    }
  }

  /** Number of requests currently in flight across all workers. */
  get busy(): number {
    let total = 0;
    for (const h of this.handles) total += h.pending.size;
    return total;
  }

  /** Number of workers in the pool. */
  get size(): number {
    return this.handles.length;
  }

  /**
   * Dispatch a mesh request to the least-busy worker. Resolves with the
   * worker's MeshResult (transferred buffers) or rejects on worker error.
   *
   * The request's Uint8Array/Uint32Array payloads (blocks, paletteIds,
   * neighborShells, blockFlags, blockMeshType) are TRANSFERRED to the worker
   * (zero-copy): their underlying ArrayBuffers are detached on the main thread
   * after the postMessage. Callers must not reuse these arrays across requests.
   */
  mesh(req: Omit<MeshRequest, 'id'>): Promise<MeshResult> {
    const id = this.nextId++;
    const fullReq: MeshRequest = { ...req, id };

    const handle = this.pickLeastBusy();

    // Collect transferable ArrayBuffers (typed array payloads). Structured
    // clone would copy these; transferring detaches them on the caller side.
    const transferables: Transferable[] = [];
    if (fullReq.blocks) transferables.push(fullReq.blocks.buffer);
    if (fullReq.paletteIds) transferables.push(fullReq.paletteIds.buffer);
    if (fullReq.neighborShells) transferables.push(fullReq.neighborShells.buffer);
    if (fullReq.blockFlags) transferables.push(fullReq.blockFlags.buffer);
    if (fullReq.blockMeshType) transferables.push(fullReq.blockMeshType.buffer);

    return new Promise<MeshResult>((resolve, reject) => {
      handle.pending.set(id, { resolve, reject });
      handle.worker.postMessage(fullReq, transferables);
    });
  }

  /** Terminate every worker. No further requests can be dispatched. */
  terminate(): void {
    for (const h of this.handles) {
      h.worker.terminate();
      h.pending.clear();
    }
    this.handles.length = 0;
  }

  private pickLeastBusy(): WorkerHandle {
    let best = this.handles[0];
    if (best === undefined) {
      throw new Error('WorkerPool has no workers (already terminated?)');
    }
    for (let i = 1; i < this.handles.length; i++) {
      const h = this.handles[i];
      if (h !== undefined && h.pending.size < best.pending.size) {
        best = h;
      }
    }
    return best;
  }
}
