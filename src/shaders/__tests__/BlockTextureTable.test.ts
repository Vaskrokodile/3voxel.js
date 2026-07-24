import { describe, it, expect } from 'vitest';
import { BlockTextureTable, FACE_TOP, FACE_BOTTOM, FACE_SIDE } from '../BlockTextureTable.js';
import type { UVRect } from '../TextureAtlas.js';

describe('BlockTextureTable', () => {
  it('stores and retrieves a UV rect per (block, face)', () => {
    const t = new BlockTextureTable(8);
    const rect: UVRect = { u0: 0.25, v0: 0.5, u1: 0.5, v1: 0.75 };
    t.set(3, FACE_TOP, rect);
    expect(t.get(3, FACE_TOP)).toEqual(rect);
  });

  it('returns null for an unset face (zero rect sentinel)', () => {
    const t = new BlockTextureTable(8);
    expect(t.get(2, FACE_SIDE)).toBeNull();
  });

  it('set(null) clears a face back to the fallback', () => {
    const t = new BlockTextureTable(8);
    t.set(1, FACE_TOP, { u0: 0.1, v0: 0.1, u1: 0.2, v1: 0.2 });
    expect(t.get(1, FACE_TOP)).not.toBeNull();
    t.set(1, FACE_TOP, null);
    expect(t.get(1, FACE_TOP)).toBeNull();
  });

  it('setFromNames resolves top/bottom/side with top/bottom falling back to side', () => {
    const t = new BlockTextureTable(8);
    const resolve = (name: string): UVRect | null => {
      if (name === 'missing') return null;
      return { u0: 0, v0: 0, u1: 0.5, v1: 0.5 };
    };
    const ok = t.setFromNames(5, { side: 'side', top: 'top' }, resolve);
    expect(ok).toBe(true);
    expect(t.get(5, FACE_SIDE)).not.toBeNull();
    expect(t.get(5, FACE_TOP)).not.toBeNull();
    // bottom omitted -> falls back to side
    expect(t.get(5, FACE_BOTTOM)).toEqual(t.get(5, FACE_SIDE));
  });

  it('uniformData has length maxBlocks * 3 * 4', () => {
    const t = new BlockTextureTable(32);
    expect(t.uniformData.length).toBe(32 * 3 * 4);
    expect(t.byteSize).toBe(t.uniformData.byteLength);
  });

  it('ignores out-of-range block ids', () => {
    const t = new BlockTextureTable(4);
    t.set(99, FACE_TOP, { u0: 1, v0: 1, u1: 2, v1: 2 });
    expect(t.get(99, FACE_TOP)).toBeNull();
  });
});
