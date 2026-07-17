/**
 * Wireframe line-list geometry describing a unit cube, for drawing a
 * selection highlight around a targeted block.
 */
export interface HighlightBox {
  /** 24 vertices (12 edges x 2 endpoints), 3 floats each = 72 floats. */
  readonly vertices: Float32Array;
  /** 24 indices (12 lines x 2). */
  readonly indices: Uint16Array;
}

/** Half-expansion applied to the highlight box to avoid z-fighting. */
const HIGHLIGHT_EXPAND = 0.0005;

/**
 * Builds wireframe line-list geometry for a unit cube around the block at
 * world coord `(x, y, z)`.
 *
 * The box is slightly larger than 1 unit (1 + 2 * 0.0005 = 1.001) so it does
 * not z-fight with the block faces it surrounds. The geometry is suitable
 * for a WebGPU line-list topology pipeline.
 */
export class SelectionHighlight {
  /**
   * @param x Block world X coordinate.
   * @param y Block world Y coordinate.
   * @param z Block world Z coordinate.
   * @returns Line-list geometry (24 vertices, 24 indices) for the box.
   */
  static buildBox(x: number, y: number, z: number): HighlightBox {
    const e = HIGHLIGHT_EXPAND;
    const x0 = x - e;
    const y0 = y - e;
    const z0 = z - e;
    const x1 = x + 1 + e;
    const y1 = y + 1 + e;
    const z1 = z + 1 + e;

    // 8 corners.
    // c000
    const c000x = x0, c000y = y0, c000z = z0;
    // c001
    const c001x = x0, c001y = y0, c001z = z1;
    // c010
    const c010x = x0, c010y = y1, c010z = z0;
    // c011
    const c011x = x0, c011y = y1, c011z = z1;
    // c100
    const c100x = x1, c100y = y0, c100z = z0;
    // c101
    const c101x = x1, c101y = y0, c101z = z1;
    // c110
    const c110x = x1, c110y = y1, c110z = z0;
    // c111
    const c111x = x1, c111y = y1, c111z = z1;

    const vertices = new Float32Array(24 * 3);

    // 12 edges, each contributing 2 vertices (24 total).
    let i = 0;
    const push = (ax: number, ay: number, az: number, bx: number, by: number, bz: number): void => {
      vertices[i] = ax; vertices[i + 1] = ay; vertices[i + 2] = az; i += 3;
      vertices[i] = bx; vertices[i + 1] = by; vertices[i + 2] = bz; i += 3;
    };

    // Bottom face (y0).
    push(c000x, c000y, c000z, c001x, c001y, c001z);
    push(c001x, c001y, c001z, c101x, c101y, c101z);
    push(c101x, c101y, c101z, c100x, c100y, c100z);
    push(c100x, c100y, c100z, c000x, c000y, c000z);
    // Top face (y1).
    push(c010x, c010y, c010z, c011x, c011y, c011z);
    push(c011x, c011y, c011z, c111x, c111y, c111z);
    push(c111x, c111y, c111z, c110x, c110y, c110z);
    push(c110x, c110y, c110z, c010x, c010y, c010z);
    // Vertical edges.
    push(c000x, c000y, c000z, c010x, c010y, c010z);
    push(c001x, c001y, c001z, c011x, c011y, c011z);
    push(c100x, c100y, c100z, c110x, c110y, c110z);
    push(c101x, c101y, c101z, c111x, c111y, c111z);

    // 24 sequential indices: [0,1, 2,3, ..., 22,23].
    const indices = new Uint16Array(24);
    for (let k = 0; k < 24; k++) {
      indices[k] = k;
    }

    return { vertices, indices };
  }
}
