import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';

import { mint, TTL_MS, verify } from './session.js';

const KEY = 'test-signing-key';
const NOW = 1_700_000_000_000;
const WHO = { uid: 'u1', gid: 'g1', staff: false };

test('a minted token verifies and carries its claims', () => {
  const { token, expiresAt } = mint(WHO, KEY, NOW);
  const result = verify(token, KEY, NOW + 1);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.claims, { ...WHO, iat: NOW, exp: NOW + TTL_MS });
  assert.equal(expiresAt, NOW + TTL_MS);
});

test('a tampered token fails on the signature before the payload is read', () => {
  const { token } = mint(WHO, KEY, NOW);
  const [a, b, , sig] = token.split('.');
  // Garbage where the payload was: not JSON, not base64 of anything useful.
  const tampered = `${a}.${b}.!!not-a-payload!!.${sig}`;
  assert.deepEqual(verify(tampered, KEY, NOW), { ok: false, reason: 'BAD_SIGNATURE' });
});

test('a valid signature over a bad payload is BAD_PAYLOAD, proving the order', () => {
  // Sign garbage with the real key: signature passes, decode fails.
  const payload = Buffer.from('{"not":"claims"}').toString('base64url');
  const sig = createHmac('sha256', KEY).update(payload).digest('base64url');
  assert.deepEqual(verify(`act.v1.${payload}.${sig}`, KEY, NOW), {
    ok: false,
    reason: 'BAD_PAYLOAD',
  });
});

test('the wrong key is BAD_SIGNATURE', () => {
  const { token } = mint(WHO, KEY, NOW);
  assert.deepEqual(verify(token, 'other-key', NOW), { ok: false, reason: 'BAD_SIGNATURE' });
});

test('past exp is EXPIRED, at exp is EXPIRED, before exp is fine', () => {
  const { token } = mint(WHO, KEY, NOW);
  assert.deepEqual(verify(token, KEY, NOW + TTL_MS + 1), { ok: false, reason: 'EXPIRED' });
  assert.deepEqual(verify(token, KEY, NOW + TTL_MS), { ok: false, reason: 'EXPIRED' });
  assert.equal(verify(token, KEY, NOW + TTL_MS - 1).ok, true);
});

test('wrong shape is MALFORMED, not an exception', () => {
  for (const bad of ['', 'act.v1', 'act.v2.x.y', 'x.y.z.w', 'act.v1.only.three.four.five']) {
    assert.deepEqual(verify(bad, KEY, NOW), { ok: false, reason: 'MALFORMED' }, bad);
  }
});

test('staff travels in the claims', () => {
  const { token } = mint({ ...WHO, staff: true }, KEY, NOW);
  const result = verify(token, KEY, NOW);
  assert.equal(result.ok && result.claims.staff, true);
});
