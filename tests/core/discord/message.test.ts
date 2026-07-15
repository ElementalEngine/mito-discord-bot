import { test } from 'node:test';
import assert from 'node:assert/strict';

import { safeDelete, deleteLater } from '../../../src/core/discord/message.js';
import type { DeletableMessage } from '../../../src/core/discord/message.js';

function fakeMessage() {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    delete() {
      calls += 1;
      return Promise.resolve();
    },
  };
}

const asDeletable = (m: unknown): DeletableMessage => m as DeletableMessage;

test('safeDelete: no-ops on null/undefined without throwing', async () => {
  await safeDelete(null);
  await safeDelete(undefined);
});

test('safeDelete: swallows a rejecting delete()', async () => {
  const msg = { delete: () => Promise.reject(new Error('boom')) };
  await safeDelete(asDeletable(msg));
});

test('safeDelete: calls delete() once on a live message', async () => {
  const msg = fakeMessage();
  await safeDelete(asDeletable(msg));
  assert.equal(msg.calls, 1);
});

test('deleteLater: does not fire before the delay, fires after', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const msg = fakeMessage();

  deleteLater(asDeletable(msg), 60_000);
  assert.equal(msg.calls, 0, 'must not delete synchronously');

  t.mock.timers.tick(59_999);
  assert.equal(msg.calls, 0, 'must not delete before the delay');

  t.mock.timers.tick(1);
  assert.equal(msg.calls, 1, 'must delete once the delay elapses');
});
