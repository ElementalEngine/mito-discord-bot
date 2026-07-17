import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createIdentityToken,
  createRoomAccessToken,
  verifyIdentityToken,
  verifyRoomAccessToken,
} from '../../../src/activity/auth/tokens.js';

import type { VerifyResult } from '../../../src/activity/auth/tokens.js';

const SECRET = 'test-secret-at-least-32-chars-long-xxxx';
const OTHER_SECRET = 'different-secret-also-32-chars-long-yyyy';
const NOW = 1_700_000_000_000; // fixed epoch ms
const TTL = 3600;

/** Narrow a VerifyResult to its ok branch (assert.ok is not a TS type guard). */
function unwrap<T>(result: VerifyResult<T>): T {
  assert.ok(result.ok, `expected ok, got ${result.ok ? '' : result.reason}`);
  return result.claims;
}

test('identity token round-trips and preserves claims', () => {
  const token = createIdentityToken(SECRET, { userId: 'u1', name: 'Alice', staff: true }, { ttlSeconds: TTL, nowMs: NOW });
  const claims = unwrap(verifyIdentityToken(SECRET, token, { nowMs: NOW }));
  assert.equal(claims.sub, 'u1');
  assert.equal(claims.name, 'Alice');
  assert.equal(claims.staff, true);
  assert.equal(claims.typ, 'identity');
});

test('identity token omits absent optional claims', () => {
  const token = createIdentityToken(SECRET, { userId: 'u1' }, { ttlSeconds: TTL, nowMs: NOW });
  const claims = unwrap(verifyIdentityToken(SECRET, token, { nowMs: NOW }));
  assert.equal(claims.name, undefined);
  assert.equal(claims.staff, undefined);
});

test('room-access token round-trips and binds sub + sessionId', () => {
  const token = createRoomAccessToken(SECRET, { userId: 'u1', sessionId: 's1' }, { ttlSeconds: TTL, nowMs: NOW });
  const claims = unwrap(verifyRoomAccessToken(SECRET, token, { userId: 'u1', sessionId: 's1' }, { nowMs: NOW }));
  assert.equal(claims.sessionId, 's1');
  assert.equal(claims.typ, 'room-access');
});

test('verify fails with no secret', () => {
  const token = createIdentityToken(SECRET, { userId: 'u1' }, { ttlSeconds: TTL, nowMs: NOW });
  const result = verifyIdentityToken('', token, { nowMs: NOW });
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.reason === 'no-secret');
});

test('verify fails on wrong secret (bad signature)', () => {
  const token = createIdentityToken(SECRET, { userId: 'u1' }, { ttlSeconds: TTL, nowMs: NOW });
  const result = verifyIdentityToken(OTHER_SECRET, token, { nowMs: NOW });
  assert.ok(!result.ok && result.reason === 'bad-signature');
});

test('verify fails on a tampered payload', () => {
  const token = createIdentityToken(SECRET, { userId: 'u1' }, { ttlSeconds: TTL, nowMs: NOW });
  const [version, , signature] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ typ: 'identity', sub: 'admin', iat: 1, exp: 9_999_999_999 }), 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
  const tampered = `${version}.${forged}.${signature}`;
  const result = verifyIdentityToken(SECRET, tampered, { nowMs: NOW });
  assert.ok(!result.ok && result.reason === 'bad-signature');
});

test('verify fails on malformed tokens', () => {
  for (const bad of [null, undefined, '', 'a.b', 'a.b.c.d', 'onlyonepart']) {
    const result = verifyIdentityToken(SECRET, bad, { nowMs: NOW });
    assert.ok(!result.ok, `expected failure for ${String(bad)}`);
    assert.ok(!result.ok && (result.reason === 'malformed' || result.reason === 'bad-version'));
  }
});

test('verify fails on wrong version (checked before signature)', () => {
  const token = createIdentityToken(SECRET, { userId: 'u1' }, { ttlSeconds: TTL, nowMs: NOW });
  const [, payload, signature] = token.split('.');
  const result = verifyIdentityToken(SECRET, `v2.${payload}.${signature}`, { nowMs: NOW });
  assert.ok(!result.ok && result.reason === 'bad-version');
});

test('expired token is rejected', () => {
  const token = createIdentityToken(SECRET, { userId: 'u1' }, { ttlSeconds: TTL, nowMs: NOW });
  const later = NOW + (TTL + 1) * 1000;
  const result = verifyIdentityToken(SECRET, token, { nowMs: later });
  assert.ok(!result.ok && result.reason === 'expired');
});

test('token issued in the far future is rejected (skew guard)', () => {
  const future = NOW + 10 * 60 * 1000; // 10 min ahead, beyond 30s tolerance
  const token = createIdentityToken(SECRET, { userId: 'u1' }, { ttlSeconds: TTL, nowMs: future });
  const result = verifyIdentityToken(SECRET, token, { nowMs: NOW });
  assert.ok(!result.ok && result.reason === 'not-yet-valid');
});

test('token confusion: identity token rejected where room-access expected', () => {
  const identity = createIdentityToken(SECRET, { userId: 'u1' }, { ttlSeconds: TTL, nowMs: NOW });
  const result = verifyRoomAccessToken(SECRET, identity, { userId: 'u1', sessionId: 's1' }, { nowMs: NOW });
  assert.ok(!result.ok && result.reason === 'wrong-type');
});

test('token confusion: room-access token rejected where identity expected', () => {
  const access = createRoomAccessToken(SECRET, { userId: 'u1', sessionId: 's1' }, { ttlSeconds: TTL, nowMs: NOW });
  const result = verifyIdentityToken(SECRET, access, { nowMs: NOW });
  assert.ok(!result.ok && result.reason === 'wrong-type');
});

test('room-access binding mismatch: wrong user', () => {
  const token = createRoomAccessToken(SECRET, { userId: 'u1', sessionId: 's1' }, { ttlSeconds: TTL, nowMs: NOW });
  const result = verifyRoomAccessToken(SECRET, token, { userId: 'u2', sessionId: 's1' }, { nowMs: NOW });
  assert.ok(!result.ok && result.reason === 'binding-mismatch');
});

test('room-access binding mismatch: wrong session', () => {
  const token = createRoomAccessToken(SECRET, { userId: 'u1', sessionId: 's1' }, { ttlSeconds: TTL, nowMs: NOW });
  const result = verifyRoomAccessToken(SECRET, token, { userId: 'u1', sessionId: 's2' }, { nowMs: NOW });
  assert.ok(!result.ok && result.reason === 'binding-mismatch');
});
