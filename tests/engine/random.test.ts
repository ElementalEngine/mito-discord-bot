import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createSeededRandom,
  pickItem,
  randomIndex,
  shuffleInPlace,
  shuffledCopy,
} from '../../src/engine/random.js';

test('createSeededRandom: deterministic per seed, distinct across seeds, output in [0,1)', () => {
  const a = createSeededRandom('seed-a');
  const b = createSeededRandom('seed-a');
  const c = createSeededRandom('seed-b');
  const seqA = Array.from({ length: 50 }, () => a());
  const seqB = Array.from({ length: 50 }, () => b());
  const seqC = Array.from({ length: 50 }, () => c());
  assert.deepEqual(seqA, seqB);
  assert.notDeepEqual(seqA, seqC);
  for (const v of [...seqA, ...seqC]) {
    assert.ok(v >= 0 && v < 1);
  }
  // numeric seeds accepted
  const n = createSeededRandom(42);
  assert.equal(typeof n(), 'number');
});

test('randomIndex: bounds and non-positive guard', () => {
  const rng = createSeededRandom('idx');
  for (let i = 0; i < 200; i += 1) {
    const v = randomIndex(rng, 7);
    assert.ok(v >= 0 && v < 7 && Number.isInteger(v));
  }
  assert.equal(randomIndex(rng, 0), 0);
  assert.equal(randomIndex(rng, -3), 0);
  // defensive clamp branch: an rng returning ~1 must not index out of range
  const nearOne: () => number = () => 0.999999999999;
  assert.equal(randomIndex(nearOne, 3), 2);
});

test('shuffleInPlace / shuffledCopy: permutation, determinism, input untouched', () => {
  const input = ['a', 'b', 'c', 'd', 'e', 'f'];
  const copy1 = shuffledCopy(input, createSeededRandom('s'));
  const copy2 = shuffledCopy(input, createSeededRandom('s'));
  assert.deepEqual(copy1, copy2);
  assert.deepEqual([...copy1].sort(), [...input].sort());
  assert.deepEqual(input, ['a', 'b', 'c', 'd', 'e', 'f']);

  const arr = [1, 2, 3, 4, 5];
  shuffleInPlace(arr, createSeededRandom('t'));
  assert.deepEqual([...arr].sort((x, y) => x - y), [1, 2, 3, 4, 5]);

  const empty: string[] = [];
  shuffleInPlace(empty, createSeededRandom('u'));
  assert.deepEqual(empty, []);
});

test('pickItem: member of pool, deterministic under seed', () => {
  const pool = ['x', 'y', 'z'];
  const rng1 = createSeededRandom('p');
  const rng2 = createSeededRandom('p');
  for (let i = 0; i < 30; i += 1) {
    const v1 = pickItem(pool, rng1);
    const v2 = pickItem(pool, rng2);
    assert.equal(v1, v2);
    assert.ok(pool.includes(v1));
  }
});

test('createSeededRandom: empty seed still produces a usable, deterministic stream', () => {
  const a = createSeededRandom('');
  const b = createSeededRandom('');
  const seq = Array.from({ length: 10 }, () => a());
  assert.deepEqual(seq, Array.from({ length: 10 }, () => b()));
  for (const v of seq) {
    assert.ok(v >= 0 && v < 1);
  }
});

test('randomIndex: clamps a contract-violating rng (>= 1) to the top valid index', () => {
  const overshoot: () => number = () => 1; // floor(1 * n) === n → must clamp to n - 1
  assert.equal(randomIndex(overshoot, 3), 2);
  assert.equal(randomIndex(overshoot, 1), 0);
});
