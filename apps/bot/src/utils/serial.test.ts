import { test } from 'node:test';
import assert from 'node:assert/strict';

import { serial } from './serial.js';

const later = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

test('runs on one key take turns, and a failure does not block the next', async () => {
  const inTurn = serial();
  const seen: string[] = [];
  const first = inTurn('m', async () => {
    seen.push('a start');
    await later(20);
    seen.push('a end');
    throw new Error('a failed');
  });
  const second = inTurn('m', async () => {
    seen.push('b start');
    return 'b';
  });
  await assert.rejects(first, /a failed/);
  assert.equal(await second, 'b');
  assert.deepEqual(seen, ['a start', 'a end', 'b start']);
});

test('another key is not held up', async () => {
  const inTurn = serial();
  const seen: string[] = [];
  const slow = inTurn('m1', async () => {
    await later(20);
    seen.push('m1');
  });
  await inTurn('m2', async () => {
    seen.push('m2');
  });
  await slow;
  assert.deepEqual(seen, ['m2', 'm1']);
});
