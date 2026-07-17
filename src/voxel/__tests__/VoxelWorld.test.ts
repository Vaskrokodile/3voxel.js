import { describe, it, expect } from 'vitest';
import { VoxelWorld, worldToChunk } from '../VoxelWorld.js';
import { BlockRegistry } from '../BlockRegistry.js';
import { AIR, CHUNK_SIZE } from '../../core/types.js';

describe('worldToChunk', () => {
  it('maps origin to chunk (0,0,0) local (0,0,0)', () => {
    const r = worldToChunk(0, 0, 0);
    expect(r.chunk).toEqual({ x: 0, y: 0, z: 0 });
    expect(r.local).toEqual({ lx: 0, ly: 0, lz: 0 });
  });

  it('maps (-1,-1,-1) to chunk (-1,-1,-1) local (15,15,15)', () => {
    const r = worldToChunk(-1, -1, -1);
    expect(r.chunk).toEqual({ x: -1, y: -1, z: -1 });
    expect(r.local).toEqual({ lx: 15, ly: 15, lz: 15 });
  });

  it('maps (-16,0,0) to chunk (-1,0,0) local (0,0,0)', () => {
    const r = worldToChunk(-16, 0, 0);
    expect(r.chunk).toEqual({ x: -1, y: 0, z: 0 });
    expect(r.local).toEqual({ lx: 0, ly: 0, lz: 0 });
  });

  it('maps (15,15,15) to chunk (0,0,0) local (15,15,15)', () => {
    const r = worldToChunk(15, 15, 15);
    expect(r.chunk).toEqual({ x: 0, y: 0, z: 0 });
    expect(r.local).toEqual({ lx: 15, ly: 15, lz: 15 });
  });

  it('maps (16,16,16) to chunk (1,1,1) local (0,0,0)', () => {
    const r = worldToChunk(16, 16, 16);
    expect(r.chunk).toEqual({ x: 1, y: 1, z: 1 });
    expect(r.local).toEqual({ lx: 0, ly: 0, lz: 0 });
  });
});

describe('VoxelWorld', () => {
  function makeWorld(): VoxelWorld {
    return new VoxelWorld(new BlockRegistry());
  }

  it('getBlock returns AIR when chunk absent', () => {
    const w = makeWorld();
    expect(w.getBlock(0, 0, 0)).toBe(AIR);
    expect(w.getBlock(-1, -1, -1)).toBe(AIR);
  });

  it('ensureChunk + setBlock/getBlock round-trips in positive coords', () => {
    const w = makeWorld();
    const c = w.ensureChunk({ x: 0, y: 0, z: 0 });
    w.setBlock(3, 4, 5, 9);
    expect(c.getBlock(3, 4, 5)).toBe(9);
    expect(w.getBlock(3, 4, 5)).toBe(9);
  });

  it('negative-coordinate block at (-1,-1,-1) maps to chunk (-1,-1,-1) local (15,15,15)', () => {
    const w = makeWorld();
    const c = w.ensureChunk({ x: -1, y: -1, z: -1 });
    w.setBlock(-1, -1, -1, 42);
    // The chunk that owns (-1,-1,-1) is (-1,-1,-1) with local (15,15,15).
    expect(c.coord).toEqual({ x: -1, y: -1, z: -1 });
    expect(c.getBlock(15, 15, 15)).toBe(42);
    expect(w.getBlock(-1, -1, -1)).toBe(42);
  });

  it('cross-chunk boundary getBlock returns AIR when neighbor chunk missing', () => {
    const w = makeWorld();
    // Create chunk (0,0,0) and place a block at its +x edge (local 15).
    w.ensureChunk({ x: 0, y: 0, z: 0 });
    w.setBlock(15, 0, 0, 7);
    expect(w.getBlock(15, 0, 0)).toBe(7);
    // The neighbour at world x=16 is in chunk (1,0,0) which is absent -> AIR.
    expect(w.getBlock(16, 0, 0)).toBe(AIR);
  });

  it('setBlock on absent chunk is a no-op', () => {
    const w = makeWorld();
    w.setBlock(100, 100, 100, 5);
    expect(w.getBlock(100, 100, 100)).toBe(AIR);
  });

  it('getChunkAt resolves the owning chunk', () => {
    const w = makeWorld();
    const c = w.ensureChunk({ x: 0, y: 0, z: 0 });
    expect(w.getChunkAt(5, 6, 7)).toBe(c);
    expect(w.getChunkAt(16, 0, 0)).toBeUndefined();
  });

  it('ensureChunk is idempotent', () => {
    const w = makeWorld();
    const a = w.ensureChunk({ x: 0, y: 0, z: 0 });
    const b = w.ensureChunk({ x: 0, y: 0, z: 0 });
    expect(a).toBe(b);
  });
});
