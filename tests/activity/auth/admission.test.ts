import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createRoomRecord, processSessionCommand } from '../../../src/session/domain.js';
import type { RoomRecord, RoomConfig, SessionDeps } from '../../../src/session/domain.js';
import { createSeededRandom } from '../../../src/engine/index.js';
import type { GameVoteConfig } from '../../../src/shared/vote.types.js';
import { admitConnection } from '../../../src/activity/auth/admission.js';
import type { AdmissionResult, AdmissionRefusal } from '../../../src/activity/auth/admission.js';
import type { Recipient } from '../../../src/session/index.js';
import { createIdentityToken, createRoomAccessToken } from '../../../src/activity/auth/tokens.js';

/** Narrow to the admitted branch (assert.ok is not a TS type guard). */
function expectAdmitted(result: AdmissionResult): Recipient {
  assert.ok(result.ok, `expected admission, got refusal ${result.ok ? '' : result.refusal.kind}`);
  return result.recipient;
}

/** Narrow to the refused branch. */
function expectRefused(result: AdmissionResult): AdmissionRefusal {
  assert.ok(!result.ok, 'expected refusal, got admission');
  return result.refusal;
}

const SECRET = 'admission-secret-at-least-32-chars-abcd';
const NOW = 1_700_000_000_000;
const TTL = 3600;

function makeDeps(seed = 'admission'): SessionDeps {
  return { now: () => NOW, rng: createSeededRandom(seed) };
}

function config(): RoomConfig {
  const voteConfig: GameVoteConfig = {
    questions: [{ id: 'draft_mode', title: 'M', defaultOptionId: 'standard', options: [{ id: 'standard', label: 'standard' }] }],
  };
  return { edition: 'CIV6', source: 'activity', mode: 'ffa', gameType: 'FFA', guildId: 'g', hostId: 'u1', voteConfig };
}

/** Lobby room with u1, u2 seated. */
function lobbyWithSeats(): RoomRecord {
  const deps = makeDeps();
  let room = createRoomRecord({ id: 's1', config: config(), createdAt: 1 });
  room = processSessionCommand(room, { type: 'JOIN', userId: 'u1' }, deps).room;
  room = processSessionCommand(room, { type: 'JOIN', userId: 'u2' }, deps).room;
  return room;
}

function identity(userId: string, staff = false): string {
  return createIdentityToken(SECRET, { userId, ...(staff ? { staff: true } : {}) }, { ttlSeconds: TTL, nowMs: NOW });
}

function access(userId: string, sessionId: string): string {
  return createRoomAccessToken(SECRET, { userId, sessionId }, { ttlSeconds: TTL, nowMs: NOW });
}

test('seated user is admitted as their own seat', () => {
  const room = lobbyWithSeats();
  const result = admitConnection({
    secret: SECRET,
    room,
    identityToken: identity('u1'),
    roomAccessToken: access('u1', 's1'),
    nowMs: NOW,
  });
  assert.deepEqual(expectAdmitted(result), { kind: 'seat', seatId: 'u1' });
});

test('seated user is admitted as a seat even if their identity token is flagged staff', () => {
  const room = lobbyWithSeats();
  const result = admitConnection({
    secret: SECRET,
    room,
    identityToken: identity('u1', true), // staff, but seated → seat view wins (K7)
    roomAccessToken: access('u1', 's1'),
    nowMs: NOW,
  });
  assert.deepEqual(expectAdmitted(result), { kind: 'seat', seatId: 'u1' });
});

test('unseated staff is admitted as an observer', () => {
  const room = lobbyWithSeats();
  const result = admitConnection({
    secret: SECRET,
    room,
    identityToken: identity('mod', true),
    roomAccessToken: access('mod', 's1'),
    nowMs: NOW,
  });
  assert.deepEqual(expectAdmitted(result), { kind: 'observer', userId: 'mod' });
});

test('unseated non-staff is refused (observer-forbidden)', () => {
  const room = lobbyWithSeats();
  const result = admitConnection({
    secret: SECRET,
    room,
    identityToken: identity('rando', false),
    roomAccessToken: access('rando', 's1'),
    nowMs: NOW,
  });
  assert.equal(expectRefused(result).kind, 'observer-forbidden');
});

test('invalid identity token → unauthenticated', () => {
  const room = lobbyWithSeats();
  const result = admitConnection({
    secret: SECRET,
    room,
    identityToken: 'garbage',
    roomAccessToken: access('u1', 's1'),
    nowMs: NOW,
  });
  assert.equal(expectRefused(result).kind, 'unauthenticated');
});

test('room-access token for the wrong session → forbidden (binding-mismatch)', () => {
  const room = lobbyWithSeats();
  const result = admitConnection({
    secret: SECRET,
    room,
    identityToken: identity('u1'),
    roomAccessToken: access('u1', 'OTHER-SESSION'),
    nowMs: NOW,
  });
  const refusal = expectRefused(result);
  assert.equal(refusal.kind, 'forbidden');
  assert.ok(refusal.kind === 'forbidden' && refusal.reason === 'binding-mismatch');
});

test('room-access token minted for a different user → forbidden', () => {
  const room = lobbyWithSeats();
  const result = admitConnection({
    secret: SECRET,
    room,
    identityToken: identity('u1'),
    roomAccessToken: access('u2', 's1'), // access bound to u2, identity is u1
    nowMs: NOW,
  });
  assert.equal(expectRefused(result).kind, 'forbidden');
});

test('missing secret → unauthenticated (identity checked first)', () => {
  const room = lobbyWithSeats();
  const result = admitConnection({
    secret: undefined,
    room,
    identityToken: identity('u1'),
    roomAccessToken: access('u1', 's1'),
    nowMs: NOW,
  });
  assert.equal(expectRefused(result).kind, 'unauthenticated');
});
