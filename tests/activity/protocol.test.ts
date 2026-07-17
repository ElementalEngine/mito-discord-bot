import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseClientMessage, toSessionCommand } from '../../src/activity/protocol.js';

const CALLER = 'caller-1';

test('JOIN maps and injects the caller identity', () => {
  const r = parseClientMessage(JSON.stringify({ type: 'JOIN' }), CALLER);
  assert.ok(r.ok);
  assert.deepEqual(r.command, { type: 'JOIN', userId: CALLER });
});

test('JOIN with an attacker-supplied userId ignores it and uses the caller', () => {
  const r = parseClientMessage(JSON.stringify({ type: 'JOIN', userId: 'victim' }), CALLER);
  assert.ok(r.ok);
  assert.equal(r.command.type === 'JOIN' && r.command.userId, CALLER);
});

test('expectedVersion is honored from the client', () => {
  const r = parseClientMessage(JSON.stringify({ type: 'JOIN', expectedVersion: 7 }), CALLER);
  assert.ok(r.ok);
  assert.equal(r.command.type === 'JOIN' && r.command.expectedVersion, 7);
});

test('SET_READY requires a boolean', () => {
  assert.ok(!parseClientMessage(JSON.stringify({ type: 'SET_READY' }), CALLER).ok);
  const good = parseClientMessage(JSON.stringify({ type: 'SET_READY', ready: true }), CALLER);
  assert.ok(good.ok && good.command.type === 'SET_READY' && good.command.ready === true);
});

test('CAST_VOTE requires questionId + string[] optionIds', () => {
  assert.ok(!parseClientMessage(JSON.stringify({ type: 'CAST_VOTE', optionIds: ['a'] }), CALLER).ok);
  assert.ok(!parseClientMessage(JSON.stringify({ type: 'CAST_VOTE', questionId: 'q', optionIds: [1] }), CALLER).ok);
  const good = parseClientMessage(JSON.stringify({ type: 'CAST_VOTE', questionId: 'q', optionIds: ['a', 'b'] }), CALLER);
  assert.ok(good.ok && good.command.type === 'CAST_VOTE' && good.command.userId === CALLER);
});

test('CAST_BAN requires both key arrays as string[]', () => {
  assert.ok(!parseClientMessage(JSON.stringify({ type: 'CAST_BAN', leaderKeys: ['l'] }), CALLER).ok);
  const good = parseClientMessage(JSON.stringify({ type: 'CAST_BAN', leaderKeys: ['l'], civKeys: [] }), CALLER);
  assert.ok(good.ok && good.command.type === 'CAST_BAN');
});

test('ADVANCE injects byUserId as the caller', () => {
  const r = parseClientMessage(JSON.stringify({ type: 'ADVANCE' }), CALLER);
  assert.ok(r.ok && r.command.type === 'ADVANCE' && r.command.byUserId === CALLER);
});

test('STAGE_PICK validates pickType + key', () => {
  assert.ok(!parseClientMessage(JSON.stringify({ type: 'STAGE_PICK', pickType: 'x', key: 'k' }), CALLER).ok);
  assert.ok(!parseClientMessage(JSON.stringify({ type: 'STAGE_PICK', pickType: 'leader' }), CALLER).ok);
  const good = parseClientMessage(JSON.stringify({ type: 'STAGE_PICK', pickType: 'leader', key: 'LEADER_X' }), CALLER);
  assert.ok(good.ok && good.command.type === 'STAGE_PICK' && good.command.userId === CALLER);
});

test('PICK requires a turnToken', () => {
  assert.ok(!parseClientMessage(JSON.stringify({ type: 'PICK', key: 'k' }), CALLER).ok);
  const good = parseClientMessage(JSON.stringify({ type: 'PICK', key: 'k', turnToken: 3 }), CALLER);
  assert.ok(good.ok && good.command.type === 'PICK' && good.command.turnToken === 3);
});

test('SELECT_CAPTAIN: caller is byUserId, chosen captain is the payload userId (a target)', () => {
  const r = toSessionCommand({ type: 'SELECT_CAPTAIN', teamIndex: 1, userId: 'captain-2' }, CALLER);
  assert.ok(r.ok && r.command.type === 'SELECT_CAPTAIN');
  assert.equal(r.command.type === 'SELECT_CAPTAIN' && r.command.byUserId, CALLER);
  assert.equal(r.command.type === 'SELECT_CAPTAIN' && r.command.userId, 'captain-2');
});

test('SELECT_CAPTAIN rejects a bad teamIndex or missing captain', () => {
  assert.ok(!toSessionCommand({ type: 'SELECT_CAPTAIN', teamIndex: 2, userId: 'c' }, CALLER).ok);
  assert.ok(!toSessionCommand({ type: 'SELECT_CAPTAIN', teamIndex: 0 }, CALLER).ok);
});

test('CANCEL defaults a reason and injects byUserId', () => {
  const r = parseClientMessage(JSON.stringify({ type: 'CANCEL' }), CALLER);
  assert.ok(r.ok && r.command.type === 'CANCEL');
  assert.equal(r.command.type === 'CANCEL' && r.command.byUserId, CALLER);
  assert.ok(r.command.type === 'CANCEL' && r.command.reason.length > 0);
});

test('TIMEOUT is not client-reachable', () => {
  const r = parseClientMessage(JSON.stringify({ type: 'TIMEOUT', token: 'phase:settings' }), CALLER);
  assert.ok(!r.ok && r.reason === 'unknown-type');
});

test('non-JSON and non-object are rejected', () => {
  assert.ok(!parseClientMessage('not json', CALLER).ok);
  const arr = parseClientMessage(JSON.stringify([1, 2, 3]), CALLER);
  assert.ok(!arr.ok && arr.reason === 'not-object');
});

test('unknown type is rejected', () => {
  const r = parseClientMessage(JSON.stringify({ type: 'HACK' }), CALLER);
  assert.ok(!r.ok && r.reason === 'unknown-type');
});
