import { randomInt } from 'node:crypto';

// `count` rolls of a die with `sides` sides, repeats allowed.
export function rollDice(count: number, sides: number, pick: (below: number) => number = randomInt): number[] {
  if (!Number.isInteger(count) || !Number.isInteger(sides) || count < 1 || sides < 1) {
    throw new RangeError(`cannot roll ${count} dice of ${sides} sides`);
  }
  return Array.from({ length: count }, () => 1 + pick(sides));
}

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
