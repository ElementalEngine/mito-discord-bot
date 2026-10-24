import { randomInt } from 'node:crypto';

// `count` distinct numbers from 1..max, in the order drawn: a turn order
// when count equals max.
export function drawDistinct(count: number, max: number, pick: (below: number) => number = randomInt): number[] {
  if (!Number.isInteger(count) || !Number.isInteger(max) || count < 1 || count > max) {
    throw new RangeError(`cannot draw ${count} distinct numbers from 1..${max}`);
  }
  const pool = Array.from({ length: max }, (_, i) => i + 1);
  for (let i = 0; i < count; i += 1) {
    const j = i + pick(max - i);
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  return pool.slice(0, count);
}
