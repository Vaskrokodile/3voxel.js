import type { BlockId } from '../core/types.js';
import { AIR_BLOCK, type BlockType } from './BlockType.js';

/**
 * Registry of block type definitions. Id 0 is reserved for AIR and is
 * auto-registered at construction.
 *
 * Id assignment: if a registered definition omits `id`, the registry assigns
 * the next sequential id starting at 1. If `id` is provided, it must not
 * collide with an existing id (including 0).
 *
 * Duplicate name handling: registering a name that already exists THROWS.
 * Names must be unique.
 */
export class BlockRegistry {
  private readonly byId: Map<BlockId, BlockType> = new Map();
  private readonly byName: Map<string, BlockType> = new Map();
  private nextId: BlockId = 1;

  constructor() {
    // Reserve id 0 for AIR.
    this.byId.set(AIR_BLOCK.id, AIR_BLOCK);
    this.byName.set(AIR_BLOCK.name, AIR_BLOCK);
  }

  /**
   * Register a block definition. If `id` is omitted, the next sequential id
   * (starting at 1) is assigned. Throws on duplicate name or id collision.
   * Returns the assigned id.
   */
  register(def: Omit<BlockType, 'id'> & { id?: BlockId }): BlockId {
    const name = def.name;
    if (this.byName.has(name)) {
      throw new Error(`BlockRegistry: duplicate block name "${name}"`);
    }

    let id: BlockId;
    if (def.id === undefined) {
      id = this.nextId;
      this.nextId += 1;
    } else {
      id = def.id;
      if (id === AIR_BLOCK.id) {
        throw new Error(`BlockRegistry: id ${AIR_BLOCK.id} is reserved for AIR`);
      }
      if (this.byId.has(id)) {
        throw new Error(`BlockRegistry: duplicate block id ${id}`);
      }
      // Keep nextId ahead of any explicitly assigned ids.
      if (id >= this.nextId) {
        this.nextId = id + 1;
      }
    }

    const full: BlockType = {
      id,
      name: def.name,
      solid: def.solid,
      transparent: def.transparent,
      opaqueFaces: def.opaqueFaces,
      color: def.color,
      meshType: def.meshType,
    };
    this.byId.set(id, full);
    this.byName.set(name, full);
    return id;
  }

  /** Get a block type by id. Throws if unknown. */
  get(id: BlockId): BlockType {
    const v = this.byId.get(id);
    if (v === undefined) {
      throw new Error(`BlockRegistry: unknown block id ${id}`);
    }
    return v;
  }

  /** Get a block type by name, or undefined if not registered. */
  getByName(name: string): BlockType | undefined {
    return this.byName.get(name);
  }

  /** Number of registered block types (including AIR). */
  get count(): number {
    return this.byId.size;
  }
}
