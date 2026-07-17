/**
 * Seedable gradient noise (Perkin-style Perlin) with 2D and 3D variants plus
 * fractal Brownian motion (fbm) helpers.
 *
 * Implementation notes
 * --------------------
 * - Gradient set: the classic Ken Perlin 12-gradient 3D set projected to 2D
 *   by dropping the y component. The 3D gradients are the 12 edge-midpoint
 *   vectors of a cube:
 *     (1,1,0),( -1,1,0),(1,-1,0),( -1,-1,0),
 *     (1,0,1),( -1,0,1),(1,0,-1),( -1,0,-1),
 *     (0,1,1),( 0,-1,1),(0,1,-1),( 0,-1,-1)
 *   For 2D we use (gx, 0, gz) and dot with (x, 0, z).
 * - Permutation table: a 512-entry table built by shuffling 0..255 with a
 *   mulberry32 PRNG seeded from `seed`, then duplicated (p[i] = p[i & 255]).
 * - Fade curve: 6t^5 - 15t^4 + 10t^3 (Perlin's improved fade).
 * - Output range is approximately [-1, 1]; we do not clamp internally so fbm
 *   can use the raw values, but the public single-octave helpers return values
 *   that stay within [-1, 1] for unit inputs.
 *
 * Determinism: same `seed` + same input coords => identical output across
 * runs and platforms (no floating-point platform divergence is introduced
 * beyond the usual IEEE-754 arithmetic).
 */

/** 12 classic Perlin gradients (edge midpoints of a cube). */
const GRAD3: ReadonlyArray<readonly [number, number, number]> = [
  [1, 1, 0],
  [-1, 1, 0],
  [1, -1, 0],
  [-1, -1, 0],
  [1, 0, 1],
  [-1, 0, 1],
  [1, 0, -1],
  [-1, 0, -1],
  [0, 1, 1],
  [0, -1, 1],
  [0, 1, -1],
  [0, -1, -1],
];

/** mulberry32 PRNG — fast, deterministic 32-bit generator. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Perlin's improved fade: 6t^5 - 15t^4 + 10t^3. */
function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Safe index into a Uint8Array. With `noUncheckedIndexedAccess` the indexed
 * access yields `number | undefined`; the permutation table is 512 entries
 * and all indices are bounded by construction, so a 0 fallback is safe.
 */
function at(arr: Uint8Array, i: number): number {
  return arr[i] ?? 0;
}

/** Build a shuffled 256-entry permutation from a seed, duplicated to 512. */
function buildPerm(seed: number): Uint8Array {
  const rng = mulberry32(seed);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  // Fisher-Yates with the seeded rng.
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = at(p, i);
    p[i] = at(p, j);
    p[j] = tmp;
  }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = at(p, i & 255);
  return perm;
}

/**
 * Seedable Perlin noise with 2D/3D sampling and fbm helpers.
 *
 * All public sampling methods return values in approximately [-1, 1].
 */
export class Noise {
  private readonly perm: Uint8Array;

  /** @param seed 32-bit integer seed. */
  constructor(seed: number) {
    this.perm = buildPerm(seed);
  }

  /** 2D Perlin noise in [-1, 1]. */
  noise2D(x: number, z: number): number {
    const X = Math.floor(x) & 255;
    const Z = Math.floor(z) & 255;
    const xf = x - Math.floor(x);
    const zf = z - Math.floor(z);

    const u = fade(xf);
    const v = fade(zf);

    const perm = this.perm;
    const aa = at(perm, at(perm, X) + Z);
    const ab = at(perm, at(perm, X) + Z + 1);
    const ba = at(perm, at(perm, X + 1) + Z);
    const bb = at(perm, at(perm, X + 1) + Z + 1);

    // 2D gradient: use grad index, dot with (xf, 0, zf).
    const gaa = gradDot2(aa, xf, zf);
    const gba = gradDot2(ba, xf - 1, zf);
    const gab = gradDot2(ab, xf, zf - 1);
    const gbb = gradDot2(bb, xf - 1, zf - 1);

    const y0 = lerp(gaa, gba, u);
    const y1 = lerp(gab, gbb, u);
    return lerp(y0, y1, v);
  }

  /** 3D Perlin noise in [-1, 1]. */
  noise3D(x: number, y: number, z: number): number {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const Z = Math.floor(z) & 255;

    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const zf = z - Math.floor(z);

    const u = fade(xf);
    const v = fade(yf);
    const w = fade(zf);

    const perm = this.perm;
    const A = at(perm, X) + Y;
    const AA = at(perm, A) + Z;
    const AB = at(perm, A + 1) + Z;
    const B = at(perm, X + 1) + Y;
    const BA = at(perm, B) + Z;
    const BB = at(perm, B + 1) + Z;

    const x0 = lerp(
      gradDot3(at(perm, AA), xf, yf, zf),
      gradDot3(at(perm, BA), xf - 1, yf, zf),
      u,
    );
    const x1 = lerp(
      gradDot3(at(perm, AB), xf, yf - 1, zf),
      gradDot3(at(perm, BB), xf - 1, yf - 1, zf),
      u,
    );
    const x2 = lerp(
      gradDot3(at(perm, AA + 1), xf, yf, zf - 1),
      gradDot3(at(perm, BA + 1), xf - 1, yf, zf - 1),
      u,
    );
    const x3 = lerp(
      gradDot3(at(perm, AB + 1), xf, yf - 1, zf - 1),
      gradDot3(at(perm, BB + 1), xf - 1, yf - 1, zf - 1),
      u,
    );

    const y0 = lerp(x0, x1, v);
    const y1 = lerp(x2, x3, v);
    return lerp(y0, y1, w);
  }

  /**
   * 2D fractal Brownian motion. Sums `octaves` of noise, each scaled by
   * `gain` in amplitude and `lacunarity` in frequency. Output stays within
   * [-1, 1] for the default gain=0.5 because amplitudes form a geometric
   * series summing to <= 1.
   */
  fbm2D(x: number, z: number, octaves: number, lacunarity: number, gain: number): number {
    let freq = 1;
    let amp = 1;
    let sum = 0;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * this.noise2D(x * freq, z * freq);
      norm += amp;
      freq *= lacunarity;
      amp *= gain;
    }
    return sum / norm;
  }

  /** 3D fractal Brownian motion. See {@link Noise.fbm2D}. */
  fbm3D(x: number, y: number, z: number, octaves: number, lacunarity: number, gain: number): number {
    let freq = 1;
    let amp = 1;
    let sum = 0;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * this.noise3D(x * freq, y * freq, z * freq);
      norm += amp;
      freq *= lacunarity;
      amp *= gain;
    }
    return sum / norm;
  }
}

/** Dot a 2D gradient (selected from GRAD3 by hash) with (x, z). */
function gradDot2(hash: number, x: number, z: number): number {
  const g = GRAD3[hash & 11] ?? [0, 0, 0];
  return g[0] * x + g[2] * z;
}

/** Dot a 3D gradient (selected from GRAD3 by hash) with (x, y, z). */
function gradDot3(hash: number, x: number, y: number, z: number): number {
  const g = GRAD3[hash & 11] ?? [0, 0, 0];
  return g[0] * x + g[1] * y + g[2] * z;
}
