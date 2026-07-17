import { describe, it, expect } from 'vitest';
import { BlockRegistry } from '../BlockRegistry.js';
import { AIR_BLOCK } from '../BlockType.js';
import { AIR } from '../../core/types.js';

describe('BlockRegistry', () => {
  it('auto-registers AIR at id 0', () => {
    const r = new BlockRegistry();
    expect(r.count).toBe(1);
    expect(r.get(AIR)).toEqual(AIR_BLOCK);
    expect(r.getByName('air')).toEqual(AIR_BLOCK);
  });

  it('auto-assigns sequential ids starting at 1', () => {
    const r = new BlockRegistry();
    const id1 = r.register({
      name: 'stone',
      solid: true,
      transparent: false,
      opaqueFaces: true,
      color: [0.5, 0.5, 0.5],
      meshType: 'cube',
    });
    const id2 = r.register({
      name: 'dirt',
      solid: true,
      transparent: false,
      opaqueFaces: true,
      color: [0.4, 0.3, 0.2],
      meshType: 'cube',
    });
    expect(id1).toBe(1);
    expect(id2).toBe(2);
    expect(r.count).toBe(3);
    expect(r.get(1).name).toBe('stone');
    expect(r.getByName('dirt')?.id).toBe(2);
  });

  it('throws on duplicate name', () => {
    const r = new BlockRegistry();
    r.register({
      name: 'stone',
      solid: true,
      transparent: false,
      opaqueFaces: true,
      color: [0.5, 0.5, 0.5],
      meshType: 'cube',
    });
    expect(() =>
      r.register({
        name: 'stone',
        solid: false,
        transparent: true,
        opaqueFaces: false,
        color: [0, 0, 0],
        meshType: 'none',
      }),
    ).toThrow(/duplicate block name/);
  });

  it('throws on explicit id 0 (reserved for AIR)', () => {
    const r = new BlockRegistry();
    expect(() =>
      r.register({
        id: 0,
        name: 'x',
        solid: true,
        transparent: false,
        opaqueFaces: true,
        color: [0, 0, 0],
        meshType: 'cube',
      }),
    ).toThrow(/reserved/);
  });

  it('throws on duplicate explicit id', () => {
    const r = new BlockRegistry();
    r.register({
      id: 5,
      name: 'a',
      solid: true,
      transparent: false,
      opaqueFaces: true,
      color: [0, 0, 0],
      meshType: 'cube',
    });
    expect(() =>
      r.register({
        id: 5,
        name: 'b',
        solid: true,
        transparent: false,
        opaqueFaces: true,
        color: [0, 0, 0],
        meshType: 'cube',
      }),
    ).toThrow(/duplicate block id/);
  });

  it('get throws on unknown id', () => {
    const r = new BlockRegistry();
    expect(() => r.get(999)).toThrow(/unknown block id/);
  });

  it('getByName returns undefined for unknown name', () => {
    const r = new BlockRegistry();
    expect(r.getByName('nope')).toBeUndefined();
  });
});
