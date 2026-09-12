import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ROW_COUNT, upstreamPath } from './allowlist.js';

const ID = '507f1f77bcf86cd799439011';

test('nine rows, matching activity_router', () => {
  assert.equal(ROW_COUNT, 9);
});

test('every allowed row maps onto /api/v2', () => {
  const cases: Array<[string, string, string]> = [
    ['GET', '/api/lobbies', '/api/v2/lobbies'],
    ['GET', `/api/lobbies/${ID}`, `/api/v2/lobbies/${ID}`],
    ['PATCH', `/api/lobbies/${ID}/seats`, `/api/v2/lobbies/${ID}/seats`],
    ['POST', `/api/lobbies/${ID}/start`, `/api/v2/lobbies/${ID}/start`],
    ['PUT', `/api/lobbies/${ID}/votes`, `/api/v2/lobbies/${ID}/votes`],
    ['PUT', `/api/lobbies/${ID}/bans`, `/api/v2/lobbies/${ID}/bans`],
    ['PUT', `/api/lobbies/${ID}/picks`, `/api/v2/lobbies/${ID}/picks`],
    ['POST', `/api/lobbies/${ID}/cancel`, `/api/v2/lobbies/${ID}/cancel`],
    ['PUT', `/api/lobbies/${ID}/ready`, `/api/v2/lobbies/${ID}/ready`],
  ];
  for (const [method, path, want] of cases) {
    assert.equal(upstreamPath(method, path), want, `${method} ${path}`);
  }
});

test('the mite_router routes are not reachable through the proxy', () => {
  assert.equal(upstreamPath('POST', '/api/lobbies'), null);
  assert.equal(upstreamPath('POST', '/api/lobbies/claim-post'), null);
});

test('the deleted /active is not reachable', () => {
  assert.equal(upstreamPath('GET', '/api/lobbies/active'), null);
});

test('the wrong method on a right path is refused', () => {
  assert.equal(upstreamPath('DELETE', `/api/lobbies/${ID}`), null);
  assert.equal(upstreamPath('GET', `/api/lobbies/${ID}/seats`), null);
});

test('a non-ObjectId never matches a parameterised row', () => {
  for (const bad of ['active', 'claim-post', '..', 'x'.repeat(24), `${ID}extra`]) {
    assert.equal(upstreamPath('GET', `/api/lobbies/${bad}`), null, bad);
  }
});

test('the path is matched whole, not by prefix', () => {
  assert.equal(upstreamPath('GET', `/api/lobbies/${ID}/seats/extra`), null);
  assert.equal(upstreamPath('GET', '/api/lobbies/'), null);
});
