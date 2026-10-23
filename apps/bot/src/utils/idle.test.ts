import { mock, test } from 'node:test';
import assert from 'node:assert/strict';

import { idleCloser } from './idle.js';

/**
 * Idle panels close. What should break this file: a panel that never closes,
 * one closed while in use, two open for one key, or a close after its token.
 */

const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

test('a panel closes when idle, activity restarts the clock, and a closed one stays closed', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const closed: string[] = [];
  const idle = idleCloser(() => 0);
  idle.open('k', 'u', 'm1', { close: async () => closed.push('first'), until: 60_000 }, 1_000);
  mock.timers.tick(900);
  assert.ok(idle.touch('k', 'm1', 1_000, { close: async () => closed.push('fresh'), until: 60_000 }));
  mock.timers.tick(999);
  assert.deepEqual(closed, []);
  mock.timers.tick(1);
  mock.timers.reset();
  await flush();
  assert.deepEqual(closed, ['fresh']);
  assert.equal(idle.touch('k', 'm1', 1_000), false);
});

test('a new panel for the key closes the old one, which can no longer act', async () => {
  const closed: string[] = [];
  const idle = idleCloser(() => 0);
  idle.open('k', 'u', 'm1', { close: async () => closed.push('old'), until: 60_000 }, 1_000);
  idle.open('k', 'u', 'm2', { close: async () => closed.push('new'), until: 60_000 }, 1_000);
  await flush();
  assert.deepEqual(closed, ['old']);
  assert.equal(idle.touch('k', 'm1', 1_000), false);
  assert.ok(idle.touch('k', 'm2', 1_000));
  assert.equal(idle.holder('k'), 'u');
  idle.close('k');
  await flush();
  assert.deepEqual(closed, ['old', 'new']);
  assert.equal(idle.holder('k'), undefined);
});

test('a panel closes before its token runs out, however busy', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  let closed = false;
  const idle = idleCloser(() => 0);
  idle.open('k', 'u', 'm1', { close: async () => (closed = true), until: 500 }, 10_000);
  mock.timers.tick(500);
  mock.timers.reset();
  assert.ok(closed);
});
