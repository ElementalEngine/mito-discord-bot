import { test } from 'node:test';
import assert from 'node:assert/strict';

import { drawDistinct } from './draw.js';

test('a draw of the whole range takes every number once', () => {
  assert.deepEqual([...drawDistinct(8, 8)].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8]);
});

test('each place takes one of the numbers not yet drawn', () => {
  assert.deepEqual(drawDistinct(3, 5, () => 0), [1, 2, 3]);
  assert.deepEqual(drawDistinct(2, 5, (below) => below - 1), [5, 1]);
});

test('a draw larger than its range is refused', () => {
  assert.throws(() => drawDistinct(3, 2), RangeError);
  assert.throws(() => drawDistinct(0, 2), RangeError);
});
