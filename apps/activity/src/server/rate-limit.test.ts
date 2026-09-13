import assert from 'node:assert/strict';
import { test } from 'node:test';

import { RateLimiter } from './rate-limit.js';

test('the limit is inclusive and the next one is refused', () => {
  const limiter = new RateLimiter(3, 1000);
  assert.equal(limiter.allow('k', 0), true);
  assert.equal(limiter.allow('k', 1), true);
  assert.equal(limiter.allow('k', 2), true);
  assert.equal(limiter.allow('k', 3), false);
});

test('a new window starts clean', () => {
  const limiter = new RateLimiter(1, 1000);
  assert.equal(limiter.allow('k', 0), true);
  assert.equal(limiter.allow('k', 999), false);
  assert.equal(limiter.allow('k', 1000), true);
});

test('keys do not share a window', () => {
  const limiter = new RateLimiter(1, 1000);
  assert.equal(limiter.allow('a', 0), true);
  assert.equal(limiter.allow('b', 0), true);
  assert.equal(limiter.allow('a', 1), false);
});

test('prune forgets expired keys and keeps live ones', () => {
  const limiter = new RateLimiter(1, 1000);
  limiter.allow('old', 0);
  limiter.allow('live', 900);
  limiter.prune(1000);
  assert.equal(limiter.allow('old', 1001), true);
  assert.equal(limiter.allow('live', 1001), false);
});
