import { AIR, type BlockId, type Vec3 } from '../core/types.js';

/**
 * A node in the sparse octree. Either:
 *  - a leaf holding 8 voxels in a 2³ cube (Uint8Array(8) of BlockIds), or
 *  - a branch with 8 child nodes (some of which may be null = all-air), or
 *  - null (represented by the absence of a child slot) = entirely air.
 *
 * Leaves store raw BlockIds directly (no palette) because octrees are used
 * for small, highly-detailed regions where palette overhead is not worth it.
 */
type OctreeNode = LeafNode | BranchNode;

interface LeafNode {
  readonly kind: 'leaf';
  voxels: Uint8Array; // length 8
}

interface BranchNode {
  readonly kind: 'branch';
  children: Array<OctreeNode | null>; // length 8
}

/**
 * Sparse voxel octree for extremely detailed regions (e.g. player-built
 * structures). Only nodes containing non-air voxels are allocated, so a
 * mostly-empty region costs almost no memory while a dense structure costs
 * memory proportional to its voxel count.
 *
 * The tree depth is `log2(size)`. A size-64 octree has depth 6
 * (64→32→16→8→4→2→leaf). `size` must be a power of two and at least 2.
 */
export class SparseOctree {
  readonly size: number;
  readonly origin: Vec3;
  private readonly depth: number;
  private root: OctreeNode | null = null;
  private solid: number = 0;

  constructor(size: number, origin: Vec3) {
    if (size < 2 || (size & (size - 1)) !== 0) {
      throw new Error(`SparseOctree: size must be a power of two >= 2, got ${size}`);
    }
    this.size = size;
    this.origin = { x: origin.x, y: origin.y, z: origin.z };
    this.depth = Math.log2(size);
  }

  /**
   * Get the block id at local coords. Returns AIR for out-of-range coords or
   * for voxels in un-allocated (all-air) subtrees. No allocations on the read
   * path.
   */
  getBlock(lx: number, ly: number, lz: number): BlockId {
    if (
      lx < 0 || lx >= this.size ||
      ly < 0 || ly >= this.size ||
      lz < 0 || lz >= this.size
    ) {
      return AIR;
    }
    let node: OctreeNode | null = this.root;
    let level = this.depth;
    let ox = 0, oy = 0, oz = 0;
    while (node !== null) {
      if (node.kind === 'leaf') {
        const bx = lx - ox;
        const by = ly - oy;
        const bz = lz - oz;
        const li = bx + (bz << 1) + (by << 2);
        return node.voxels[li] as BlockId;
      }
      // branch: pick the child octant
      const half = 1 << (level - 1);
      const cx = (lx - ox) >= half ? 1 : 0;
      const cy = (ly - oy) >= half ? 1 : 0;
      const cz = (lz - oz) >= half ? 1 : 0;
      const ci = cx + (cz << 1) + (cy << 2);
      node = node.children[ci] as OctreeNode | null;
      ox += cx * half;
      oy += cy * half;
      oz += cz * half;
      level -= 1;
    }
    return AIR;
  }

  /**
   * Set the block id at local coords. Out-of-range writes are ignored.
   * Allocates branch/leaf nodes as needed to reach the voxel.
   */
  setBlock(lx: number, ly: number, lz: number, id: BlockId): void {
    if (
      lx < 0 || lx >= this.size ||
      ly < 0 || ly >= this.size ||
      lz < 0 || lz >= this.size
    ) {
      return;
    }
    const prev = this.getBlock(lx, ly, lz);
    if (prev === id) {
      return;
    }
    if (prev === AIR && id !== AIR) {
      this.solid++;
    } else if (prev !== AIR && id === AIR) {
      this.solid--;
    }

    if (this.depth === 1) {
      // Root is a single leaf.
      if (this.root === null) {
        this.root = { kind: 'leaf', voxels: new Uint8Array(8) };
      }
      const leaf = this.root as LeafNode;
      const li = lx + (lz << 1) + (ly << 2);
      leaf.voxels[li] = id;
      // If the leaf is now all-air, drop it to keep the tree sparse.
      if (id === AIR && this.isLeafEmpty(leaf)) {
        this.root = null;
      }
      return;
    }

    this.root = this.setRecursive(
      this.root,
      0, 0, 0,
      this.depth,
      lx, ly, lz,
      id,
    );
  }

  private setRecursive(
    node: OctreeNode | null,
    ox: number, oy: number, oz: number,
    level: number,
    lx: number, ly: number, lz: number,
    id: BlockId,
  ): OctreeNode | null {
    if (level === 1) {
      // Leaf level: 2³ voxels.
      let leaf: LeafNode;
      if (node !== null && node.kind === 'leaf') {
        leaf = node;
      } else {
        leaf = { kind: 'leaf', voxels: new Uint8Array(8) };
      }
      const bx = lx - ox;
      const by = ly - oy;
      const bz = lz - oz;
      const li = bx + (bz << 1) + (by << 2);
      leaf.voxels[li] = id;
      if (id === AIR && this.isLeafEmpty(leaf)) {
        return null;
      }
      return leaf;
    }

    // Branch level.
    const half = 1 << (level - 1);
    const cx = (lx - ox) >= half ? 1 : 0;
    const cy = (ly - oy) >= half ? 1 : 0;
    const cz = (lz - oz) >= half ? 1 : 0;
    const ci = cx + (cz << 1) + (cy << 2);

    let branch: BranchNode;
    if (node !== null && node.kind === 'branch') {
      branch = node;
    } else {
      branch = { kind: 'branch', children: new Array<OctreeNode | null>(8).fill(null) };
    }

    const child = branch.children[ci] as OctreeNode | null;
    branch.children[ci] = this.setRecursive(
      child,
      ox + cx * half,
      oy + cy * half,
      oz + cz * half,
      level - 1,
      lx, ly, lz,
      id,
    );

    // If all children are null, collapse the branch to keep the tree sparse.
    if (this.isBranchEmpty(branch)) {
      return null;
    }
    return branch;
  }

  private isLeafEmpty(leaf: LeafNode): boolean {
    const v = leaf.voxels;
    for (let i = 0; i < 8; i++) {
      if ((v[i] as BlockId) !== AIR) {
        return false;
      }
    }
    return true;
  }

  private isBranchEmpty(branch: BranchNode): boolean {
    const c = branch.children;
    for (let i = 0; i < 8; i++) {
      if (c[i] !== null) {
        return false;
      }
    }
    return true;
  }

  /**
   * Invoke `callback` for every non-air voxel in the tree, in unspecified
   * order. Used by meshers to iterate solid voxels without scanning empty
   * space.
   */
  forEachSolid(callback: (lx: number, ly: number, lz: number, id: BlockId) => void): void {
    if (this.root === null) {
      return;
    }
    this.forEachSolidRecursive(this.root, 0, 0, 0, this.depth, callback);
  }

  private forEachSolidRecursive(
    node: OctreeNode,
    ox: number, oy: number, oz: number,
    level: number,
    callback: (lx: number, ly: number, lz: number, id: BlockId) => void,
  ): void {
    if (node.kind === 'leaf') {
      const v = node.voxels;
      for (let i = 0; i < 8; i++) {
        const id = v[i] as BlockId;
        if (id !== AIR) {
          const bx = i & 1;
          const bz = (i >> 1) & 1;
          const by = (i >> 2) & 1;
          callback(ox + bx, oy + by, oz + bz, id);
        }
      }
      return;
    }
    const half = 1 << (level - 1);
    const c = node.children;
    for (let i = 0; i < 8; i++) {
      const child = c[i] as OctreeNode | null;
      if (child === null) {
        continue;
      }
      const cx = i & 1;
      const cz = (i >> 1) & 1;
      const cy = (i >> 2) & 1;
      this.forEachSolidRecursive(
        child,
        ox + cx * half,
        oy + cy * half,
        oz + cz * half,
        level - 1,
        callback,
      );
    }
  }

  /** Number of non-air voxels stored in the tree. */
  get solidCount(): number {
    return this.solid;
  }

  /**
   * Approximate memory usage in bytes: each leaf is 8 bytes (Uint8Array(8))
   * plus object/array overhead; each branch is an 8-slot array plus object
   * overhead. The estimate uses a fixed per-node overhead constant.
   */
  get memoryBytes(): number {
    if (this.root === null) {
      return 0;
    }
    // Per-node overhead: JS object header + array backing. Conservative.
    const LEAF_OVERHEAD = 24; // object + Uint8Array(8) buffer header
    const BRANCH_OVERHEAD = 64; // object + 8-slot array
    let leaves = 0;
    let branches = 0;
    this.countNodes(this.root, this.depth, (l, b) => {
      leaves += l;
      branches += b;
    });
    return leaves * (8 + LEAF_OVERHEAD) + branches * BRANCH_OVERHEAD;
  }

  private countNodes(
    node: OctreeNode,
    level: number,
    acc: (leaves: number, branches: number) => void,
  ): void {
    if (node.kind === 'leaf') {
      acc(1, 0);
      return;
    }
    acc(0, 1);
    const c = node.children;
    for (let i = 0; i < 8; i++) {
      const child = c[i] as OctreeNode | null;
      if (child !== null) {
        this.countNodes(child, level - 1, acc);
      }
    }
  }
}
