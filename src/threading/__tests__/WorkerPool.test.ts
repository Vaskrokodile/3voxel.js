import { describe, expect, it } from 'vitest';
import type { MeshRequest, MeshResult } from '../messages.js';
import { WorkerPool } from '../WorkerPool.js';

/**
 * Fake Worker that captures inbound requests and lets the test deliver
 * outbound results via `respond`. Implements the surface the WorkerPool
 * uses: postMessage / onmessage / onerror / terminate.
 */
class FakeWorker {
  readonly url: string;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: ErrorEvent) => void) | null = null;
  private lastReq: MeshRequest | null = null;
  terminated = false;

  constructor(url: string) {
    this.url = url;
  }

  postMessage(data: unknown): void {
    this.lastReq = data as MeshRequest;
  }

  terminate(): void {
    this.terminated = true;
  }

  /** Whether this fake is holding an unresponded request. */
  hasPendingRequest(): boolean {
    return this.lastReq !== null;
  }

  /** Deliver a MeshResult to the pool's onmessage handler. */
  respond(result: Omit<MeshResult, 'id' | 'type'> & { id?: number }): void {
    const req = this.lastReq;
    if (req === null) throw new Error('FakeWorker: no request to respond to');
    const full: MeshResult = {
      type: 'meshResult',
      id: result.id ?? req.id,
      ...result,
    };
    this.lastReq = null;
    if (this.onmessage) {
      this.onmessage({ data: full } as MessageEvent);
    }
  }
}

describe('WorkerPool', () => {
  it('dispatches a mesh request and resolves with the worker result', async () => {
    const fakes: FakeWorker[] = [];
    const pool = new WorkerPool('fake-url', {
      size: 2,
      workerFactory: (url: string) => {
        const w = new FakeWorker(url);
        fakes.push(w);
        return w as unknown as Worker;
      },
    });

    expect(pool.size).toBe(2);
    expect(pool.busy).toBe(0);

    const promise = pool.mesh({
      type: 'mesh',
      chunkCoord: { x: 1, y: 2, z: 3 },
      worldOrigin: { x: 16, y: 32, z: 48 },
      blocks: new Uint8Array(4096),
      paletteIds: new Uint32Array([0, 1]),
    });

    // The request is now in flight on one of the fake workers.
    expect(pool.busy).toBe(1);

    // Find the fake that received the request and deliver a result.
    const fake = fakes.find((f) => f.hasPendingRequest());
    expect(fake).toBeDefined();
    fake!.respond({
      chunk: { x: 1, y: 2, z: 3 },
      vertices: new Uint8Array(36),
      indices: new Uint8Array(12),
      indexFormat: 'uint16',
      vertexCount: 1,
      indexCount: 6,
      opaqueIndexCount: 6,
      transparentIndexCount: 0,
    });

    const result = await promise;
    expect(result.type).toBe('meshResult');
    expect(result.chunk).toEqual({ x: 1, y: 2, z: 3 });
    expect(pool.busy).toBe(0);

    pool.terminate();
    expect(fakes[0]!.terminated).toBe(true);
    expect(fakes[1]!.terminated).toBe(true);
  });

  it('rejects on worker error', async () => {
    const fakes: FakeWorker[] = [];
    const pool = new WorkerPool('fake-url', {
      size: 1,
      workerFactory: (url: string) => {
        const w = new FakeWorker(url);
        fakes.push(w);
        return w as unknown as Worker;
      },
    });

    const promise = pool.mesh({
      type: 'mesh',
      chunkCoord: { x: 0, y: 0, z: 0 },
      worldOrigin: { x: 0, y: 0, z: 0 },
      blocks: new Uint8Array(4096),
      paletteIds: new Uint32Array([0]),
    });

    // Trigger an error on the worker. Use a plain object shaped like an
    // ErrorEvent (Node's vitest environment has no DOM ErrorEvent ctor).
    fakes[0]!.onerror!({ message: 'boom' } as unknown as ErrorEvent);

    await expect(promise).rejects.toThrow('boom');
    pool.terminate();
  });

  it('dispatches to the least-busy worker', async () => {
    const fakes: FakeWorker[] = [];
    const pool = new WorkerPool('fake-url', {
      size: 3,
      workerFactory: (url: string) => {
        const w = new FakeWorker(url);
        fakes.push(w);
        return w as unknown as Worker;
      },
    });

    // Issue 3 requests; each fake should receive exactly one (round-robin
    // by least-busy since all start idle).
    const promises = [
      pool.mesh({
        type: 'mesh', chunkCoord: { x: 0, y: 0, z: 0 }, worldOrigin: { x: 0, y: 0, z: 0 },
        blocks: new Uint8Array(4096), paletteIds: new Uint32Array([0]),
      }),
      pool.mesh({
        type: 'mesh', chunkCoord: { x: 1, y: 0, z: 0 }, worldOrigin: { x: 16, y: 0, z: 0 },
        blocks: new Uint8Array(4096), paletteIds: new Uint32Array([0]),
      }),
      pool.mesh({
        type: 'mesh', chunkCoord: { x: 2, y: 0, z: 0 }, worldOrigin: { x: 32, y: 0, z: 0 },
        blocks: new Uint8Array(4096), paletteIds: new Uint32Array([0]),
      }),
    ];

    expect(pool.busy).toBe(3);
    for (const f of fakes) {
      f.respond({
        chunk: { x: 0, y: 0, z: 0 },
        vertices: new Uint8Array(0),
        indices: new Uint8Array(0),
        indexFormat: 'uint16',
        vertexCount: 0,
        indexCount: 0,
        opaqueIndexCount: 0,
        transparentIndexCount: 0,
      });
    }
    const results = await Promise.all(promises);
    expect(results.length).toBe(3);
    pool.terminate();
  });
});
