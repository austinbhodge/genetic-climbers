/**
 * Seedable RNG for reproducible headless experiments.
 *
 * The simulation core uses bare `Math.random()` in many places (NEAT mutation,
 * spawn jitter, etc). Rather than thread a seed through every call site, the
 * headless runner installs a seeded PRNG as `Math.random` for the duration of
 * a run. This makes a given `--seed` fully reproducible.
 */

/** Mulberry32: fast, decent-quality 32-bit seeded PRNG. */
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let original: (() => number) | null = null;

/** Replace Math.random with a seeded generator. Returns the generator. */
export function installSeededRandom(seed: number): () => number {
  if (original === null) original = Math.random;
  const gen = mulberry32(seed);
  Math.random = gen;
  return gen;
}

/** Restore the native Math.random. */
export function restoreRandom(): void {
  if (original !== null) {
    Math.random = original;
    original = null;
  }
}
