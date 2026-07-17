/**
 * Procedural texture atlas for block textures.
 *
 * tdjs has zero runtime dependencies, so block textures are generated
 * procedurally at runtime rather than loaded from image files. A
 * {@link TextureAtlas} owns a single RGBA8 atlas texture divided into a grid of
 * tiles. Callers register named textures by supplying a pixel generator
 * function; the atlas renders each generator into its tile, then
 * {@link TextureAtlas.upload} uploads the whole atlas to a GPU texture.
 *
 * Default layout: 16×16 px tiles, 16 tiles per row, 16 rows → a 256×256 atlas
 * with room for 256 tiles.
 */

/** A registered texture's location within the atlas (in tile units). */
export interface TextureEntry {
  /** Logical name (for lookup via {@link TextureAtlas.getUV}). */
  readonly name: string;
  /** Atlas tile column (0-based). */
  readonly x: number;
  /** Atlas tile row (0-based). */
  readonly y: number;
  /** Width in tiles. */
  readonly width: number;
  /** Height in tiles. */
  readonly height: number;
}

/** UV rectangle for a registered texture. */
export interface UVRect {
  readonly u0: number;
  readonly v0: number;
  readonly u1: number;
  readonly v1: number;
}

/** A pixel generator: maps (x, y) within a tile to an [r, g, b, a] tuple (0..255). */
export type PixelGenerator = (x: number, y: number) => readonly [number, number, number, number];

/** Default tile size in pixels. */
export const DEFAULT_TILE_SIZE = 16;
/** Default number of tiles per atlas row. */
export const DEFAULT_TILES_PER_ROW = 16;
/** Default number of atlas rows. */
export const DEFAULT_ROW_COUNT = 16;

/**
 * Runtime-generated texture atlas.
 *
 * Tiles are allocated left-to-right, top-to-bottom on a first-come basis. The
 * atlas is CPU-side until {@link TextureAtlas.upload} is called, after which
 * {@link TextureAtlas.getBindGroupEntry} and {@link TextureAtlas.createSampler}
 * provide the GPU resources for binding.
 */
export class TextureAtlas {
  private readonly device: GPUDevice;
  private readonly tileSize: number;
  private readonly tilesPerRow: number;
  private readonly rowCount: number;
  private readonly atlasWidth: number;
  private readonly atlasHeight: number;
  private readonly pixels: Uint8Array<ArrayBuffer>;
  private readonly entries = new Map<string, TextureEntry>();
  private nextTile = 0;
  private gpuTexture: GPUTexture | null = null;

  /**
   * @param device       The GPU device used to create the atlas texture.
   * @param tileSize     Pixels per tile edge (default 16).
   * @param tilesPerRow  Tiles per atlas row (default 16).
   * @param rowCount     Number of atlas rows (default 16).
   */
  public constructor(
    device: GPUDevice,
    tileSize: number = DEFAULT_TILE_SIZE,
    tilesPerRow: number = DEFAULT_TILES_PER_ROW,
    rowCount: number = DEFAULT_ROW_COUNT,
  ) {
    this.device = device;
    this.tileSize = tileSize;
    this.tilesPerRow = tilesPerRow;
    this.rowCount = rowCount;
    this.atlasWidth = tilesPerRow * tileSize;
    this.atlasHeight = rowCount * tileSize;
    this.pixels = new Uint8Array(new ArrayBuffer(this.atlasWidth * this.atlasHeight * 4));
  }

  /** Total number of tiles the atlas can hold. */
  public get capacity(): number {
    return this.tilesPerRow * this.rowCount;
  }

  /** Atlas width in pixels. */
  public get width(): number {
    return this.atlasWidth;
  }

  /** Atlas height in pixels. */
  public get height(): number {
    return this.atlasHeight;
  }

  /**
   * Register a named, procedurally generated texture.
   *
   * The generator is called once per pixel in the allocated tile(s); the
   * returned RGBA values are written into the CPU-side atlas buffer. Tiles are
   * allocated sequentially; an error is thrown if the atlas is full.
   *
   * @param name      Unique texture name.
   * @param generator Maps in-tile (x, y) → [r, g, b, a] (each 0..255).
   * @returns The allocated {@link TextureEntry}.
   */
  public register(name: string, generator: PixelGenerator): TextureEntry {
    if (this.entries.has(name)) {
      throw new TextureAtlasError(`Texture '${name}' is already registered.`);
    }
    if (this.nextTile >= this.capacity) {
      throw new TextureAtlasError('Texture atlas is full.');
    }
    const tileX = this.nextTile % this.tilesPerRow;
    const tileY = Math.floor(this.nextTile / this.tilesPerRow);
    const entry: TextureEntry = { name, x: tileX, y: tileY, width: 1, height: 1 };
    this.writeTile(tileX, tileY, 1, 1, generator);
    this.entries.set(name, entry);
    this.nextTile += 1;
    return entry;
  }

  /**
   * Register a multi-tile texture (width × height tiles). The generator is
   * called across the full multi-tile region with (x, y) in pixel coordinates
   * relative to the region origin.
   */
  public registerMulti(
    name: string,
    widthTiles: number,
    heightTiles: number,
    generator: PixelGenerator,
  ): TextureEntry {
    if (this.entries.has(name)) {
      throw new TextureAtlasError(`Texture '${name}' is already registered.`);
    }
    const needed = widthTiles * heightTiles;
    if (this.nextTile + needed > this.capacity) {
      throw new TextureAtlasError('Texture atlas is full.');
    }
    const startX = this.nextTile % this.tilesPerRow;
    const startY = Math.floor(this.nextTile / this.tilesPerRow);
    // Ensure the region fits on a single row band.
    if (startX + widthTiles > this.tilesPerRow) {
      throw new TextureAtlasError('Multi-tile texture does not fit in the remaining row space.');
    }
    const entry: TextureEntry = { name, x: startX, y: startY, width: widthTiles, height: heightTiles };
    const regionPxW = widthTiles * this.tileSize;
    const regionPxH = heightTiles * this.tileSize;
    const originPxX = startX * this.tileSize;
    const originPxY = startY * this.tileSize;
    for (let y = 0; y < regionPxH; y++) {
      for (let x = 0; x < regionPxW; x++) {
        const [r, g, b, a] = generator(x, y);
        this.setPixel(originPxX + x, originPxY + y, r, g, b, a);
      }
    }
    this.entries.set(name, entry);
    this.nextTile += needed;
    return entry;
  }

  /** Look up the UV rectangle for a registered texture, or `null` if absent. */
  public getUV(name: string): UVRect | null {
    const e = this.entries.get(name);
    if (e === undefined) return null;
    const u0 = (e.x * this.tileSize) / this.atlasWidth;
    const u1 = ((e.x + e.width) * this.tileSize) / this.atlasWidth;
    const v0 = (e.y * this.tileSize) / this.atlasHeight;
    const v1 = ((e.y + e.height) * this.tileSize) / this.atlasHeight;
    return { u0, v0, u1, v1 };
  }

  /**
   * Upload the CPU-side atlas to a GPU texture (RGBA8Unorm, sampled).
   * Subsequent calls reuse the existing texture unless {@link TextureAtlas.dispose}
   * is called.
   */
  public upload(): GPUTexture {
    if (this.gpuTexture !== null) return this.gpuTexture;
    const texture = this.device.createTexture({
      size: { width: this.atlasWidth, height: this.atlasHeight, depthOrArrayLayers: 1 },
      format: 'rgba8unorm',
      usage:
        GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
      label: 'tdjs-texture-atlas',
    });
    this.device.queue.writeTexture(
      { texture },
      this.pixels,
      { bytesPerRow: this.atlasWidth * 4, rowsPerImage: this.atlasHeight },
      { width: this.atlasWidth, height: this.atlasHeight, depthOrArrayLayers: 1 },
    );
    this.gpuTexture = texture;
    return texture;
  }

  /** Create a bind group entry for the atlas texture view. */
  public getBindGroupEntry(binding: number): GPUBindGroupEntry {
    if (this.gpuTexture === null) {
      throw new TextureAtlasError('upload() must be called before getBindGroupEntry().');
    }
    return { binding, resource: this.gpuTexture.createView() };
  }

  /** Create a linear sampler suitable for block textures. */
  public createSampler(): GPUSampler {
    return this.device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      mipmapFilter: 'linear',
      addressModeU: 'repeat',
      addressModeV: 'repeat',
    });
  }

  /** Release the GPU texture (the CPU-side atlas is retained). */
  public dispose(): void {
    this.gpuTexture?.destroy();
    this.gpuTexture = null;
  }

  // ---- internals ---------------------------------------------------------

  /** Write a 1×1 tile region using `generator` over its pixels. */
  private writeTile(tileX: number, tileY: number, wTiles: number, hTiles: number, generator: PixelGenerator): void {
    const px0 = tileX * this.tileSize;
    const py0 = tileY * this.tileSize;
    const pxW = wTiles * this.tileSize;
    const pxH = hTiles * this.tileSize;
    for (let y = 0; y < pxH; y++) {
      for (let x = 0; x < pxW; x++) {
        const [r, g, b, a] = generator(x, y);
        this.setPixel(px0 + x, py0 + y, r, g, b, a);
      }
    }
  }

  /** Set one atlas pixel (no bounds checking — callers stay in range). */
  private setPixel(px: number, py: number, r: number, g: number, b: number, a: number): void {
    const idx = (py * this.atlasWidth + px) * 4;
    this.pixels[idx] = clamp8(r);
    this.pixels[idx + 1] = clamp8(g);
    this.pixels[idx + 2] = clamp8(b);
    this.pixels[idx + 3] = clamp8(a);
  }
}

/** Clamp a channel value to [0, 255] and round to the nearest integer. */
function clamp8(v: number): number {
  if (v < 0) return 0;
  if (v > 255) return 255;
  return Math.round(v);
}

/** Typed error thrown by the texture atlas. */
export class TextureAtlasError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'TextureAtlasError';
  }
}

// ---- Built-in procedural texture generators -------------------------------

/** Deterministic value-noise in [0,1) from integer coords (no deps). */
function hash2(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >>> 13)) | 0;
  h = (h * 1274126177) | 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/** Smooth interpolated noise. */
function smoothNoise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  return a * (1 - sx) * (1 - sy) + b * sx * (1 - sy) + c * (1 - sx) * sy + d * sx * sy;
}

/** Add subtle per-pixel noise to a base color. */
function noisy(base: readonly [number, number, number], variance: number): PixelGenerator {
  return (x, y) => {
    const n = smoothNoise(x * 0.5, y * 0.5) - 0.5;
    return [
      base[0] + n * variance,
      base[1] + n * variance,
      base[2] + n * variance,
      255,
    ];
  };
}

/** Stone: noisy gray. */
export const STONE_GENERATOR: PixelGenerator = noisy([128, 128, 128], 24);
/** Dirt: noisy brown. */
export const DIRT_GENERATOR: PixelGenerator = noisy([120, 80, 50], 24);
/** Grass top: noisy green. */
export const GRASS_TOP_GENERATOR: PixelGenerator = noisy([86, 140, 56], 24);
/** Sand: noisy yellow. */
export const SAND_GENERATOR: PixelGenerator = noisy([214, 198, 130], 18);
/** Leaves: noisy dark green. */
export const LEAVES_GENERATOR: PixelGenerator = noisy([54, 96, 40], 28);
/** Snow: near-white with subtle noise. */
export const SNOW_GENERATOR: PixelGenerator = noisy([240, 244, 250], 10);

/** Grass side: green top half, dirt bottom half. */
export const GRASS_SIDE_GENERATOR: PixelGenerator = (x, y, size = 16) => {
  const half = size / 2;
  if (y < half) {
    return GRASS_TOP_GENERATOR(x, y);
  }
  return DIRT_GENERATOR(x, y - half);
};

/** Water: blue with a subtle sine-wave pattern. */
export const WATER_GENERATOR: PixelGenerator = (x, y) => {
  const wave = Math.sin((x + y) * 0.6) * 8 + Math.sin(x * 0.9) * 4;
  const n = smoothNoise(x * 0.4, y * 0.4) - 0.5;
  return [48 + n * 10, 96 + wave + n * 8, 180 + n * 10, 200];
};

/** Log top: tree rings. */
export const LOG_TOP_GENERATOR: PixelGenerator = (x, y, size = 16) => {
  const cx = size / 2 - 0.5;
  const cy = size / 2 - 0.5;
  const dx = x - cx;
  const dy = y - cy;
  const r = Math.sqrt(dx * dx + dy * dy);
  const ring = Math.sin(r * 1.8) * 0.5 + 0.5;
  const base = 120 + ring * 30;
  const n = smoothNoise(x * 0.5, y * 0.5) - 0.5;
  return [base + n * 12, 88 + n * 10, 56 + n * 8, 255];
};

/** Log side: vertical bark lines. */
export const LOG_SIDE_GENERATOR: PixelGenerator = (x, y) => {
  const line = Math.sin(x * 1.2) * 0.5 + 0.5;
  const base = 110 + line * 30;
  const n = smoothNoise(x * 0.6, y * 0.3) - 0.5;
  return [base + n * 14, 80 + n * 10, 50 + n * 8, 255];
};

/**
 * Register all built-in procedural block textures on an atlas.
 *
 * @param atlas The atlas to populate.
 * @returns A map of texture name → {@link TextureEntry}.
 */
export function registerBuiltinTextures(atlas: TextureAtlas): Map<string, TextureEntry> {
  const result = new Map<string, TextureEntry>();
  const defs: readonly [string, PixelGenerator][] = [
    ['stone', STONE_GENERATOR],
    ['dirt', DIRT_GENERATOR],
    ['grass_top', GRASS_TOP_GENERATOR],
    ['grass_side', GRASS_SIDE_GENERATOR],
    ['sand', SAND_GENERATOR],
    ['water', WATER_GENERATOR],
    ['log_top', LOG_TOP_GENERATOR],
    ['log_side', LOG_SIDE_GENERATOR],
    ['leaves', LEAVES_GENERATOR],
    ['snow', SNOW_GENERATOR],
  ];
  for (const [name, gen] of defs) {
    result.set(name, atlas.register(name, gen));
  }
  return result;
}
