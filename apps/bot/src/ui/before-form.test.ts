import { test } from 'node:test';
import assert from 'node:assert/strict';

import { beforeForm } from './before-form.js';
import { Refusal } from './reply.js';

const pressedAgo = (ms: number) => ({ createdTimestamp: Date.now() - ms }) as never;

test('a read that would outlast the 3 second window is refused before it', async () => {
  const slow = new Promise((resolve) => setTimeout(resolve, 5_000, 'late').unref());
  const started = Date.now();
  await assert.rejects(beforeForm(pressedAgo(1_000), slow), Refusal);
  assert.ok(Date.now() - started < 2_000);
});

test('a quick read passes through', async () => {
  assert.equal(await beforeForm(pressedAgo(0), Promise.resolve('rows')), 'rows');
});
