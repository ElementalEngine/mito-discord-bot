export type RandomSource = () => number;

export function createSeededRandom(seed: string | number): RandomSource {
  const seedText = String(seed);
  let hash = 2166136261;
  for (let index = 0; index < seedText.length; index += 1) {
    hash ^= seedText.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  let state = hash >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let next = Math.imul(state ^ (state >>> 15), 1 | state);
    next ^= next + Math.imul(next ^ (next >>> 7), 61 | next);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer in [0, maxExclusive). Mirrors node:crypto randomInt(0, n) usage in the legacy pool service. */
export function randomIndex(rng: RandomSource, maxExclusive: number): number {
  if (maxExclusive <= 0) return 0;
  const value = Math.floor(rng() * maxExclusive);
  return value >= maxExclusive ? maxExclusive - 1 : value;
}

/** In-place Fisher–Yates shuffle. Structure mirrors legacy shufflePool with the rng injected. */
export function shuffleInPlace<T>(arr: T[], rng: RandomSource): void {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = randomIndex(rng, i + 1);
    const a = arr[i] as T;
    arr[i] = arr[j] as T;
    arr[j] = a;
  }
}

/** Shuffled copy. Mirrors legacy shuffledPoolCopy with the rng injected. */
export function shuffledCopy<T>(items: readonly T[], rng: RandomSource): T[] {
  const copy = items.slice();
  shuffleInPlace(copy, rng);
  return copy;
}

/** Random element. Mirrors legacy pickRandomPoolItem with the rng injected. Callers guarantee non-empty input. */
export function pickItem<T>(items: readonly T[], rng: RandomSource): T {
  return items[randomIndex(rng, items.length)] as T;
}
