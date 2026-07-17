import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createRoomRecord,
  processSessionCommand,
} from '../../src/session/domain.js';
import type { RoomRecord, RoomConfig, SessionCommand, SessionDeps, SessionEffect } from '../../src/session/domain.js';
import { createSeededRandom } from '../../src/engine/random.js';
import { CIV6_LEADERS } from '../../src/data/civ6.data.js';
import type { GameVoteConfig } from '../../src/shared/vote.types.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

const NOW = 1_700_000_000_000;
function makeDeps(seed = 'domain-test'): SessionDeps {
  return { now: () => NOW, rng: createSeededRandom(seed) };
}

function voteConfig(draftModes: readonly string[]): GameVoteConfig {
  return {
    questions: [
      { id: 'duration', title: 'Duration', defaultOptionId: '6h', options: [{ id: '4h', label: '4h' }, { id: '6h', label: '6h' }] },
      { id: 'map', title: 'Map', defaultOptionId: 'pangea', maxSelections: 3, options: [{ id: 'pangea', label: 'P' }, { id: 'seven', label: 'S' }, { id: 'high', label: 'H' }] },
      { id: 'draft_mode', title: 'Draft Mode', defaultOptionId: draftModes[0] ?? 'standard', options: draftModes.map((id) => ({ id, label: id })) },
    ],
  };
}

function ffaConfig(draftModes: readonly string[] = ['standard', 'snake', 'blind']): RoomConfig {
  return { edition: 'CIV6', source: 'activity', mode: 'ffa', gameType: 'FFA', guildId: 'g1', hostId: 'u1', voteConfig: voteConfig(draftModes) };
}

/** Apply a command and return the transition (asserting acceptance unless expectReject). */
function step(room: RoomRecord, command: SessionCommand, deps: SessionDeps) {
  return processSessionCommand(room, command, deps);
}

function join(room: RoomRecord, users: readonly string[], deps: SessionDeps): RoomRecord {
  let next = room;
  for (const userId of users) next = step(next, { type: 'JOIN', userId }, deps).room;
  return next;
}

function effectTypes(effects: readonly SessionEffect[]): string[] {
  return effects.map((e) => e.type);
}

const LEADER_KEY = Object.keys(CIV6_LEADERS)[0] as string;

// ── Tests ───────────────────────────────────────────────────────────────────

test('standard: walks lobby → settings → bans → draft → complete and emits the Complete effects', () => {
  const deps = makeDeps();
  let room = createRoomRecord({ id: 's-standard', config: ffaConfig(), createdAt: 1 });
  room = join(room, ['u1', 'u2', 'u3'], deps);
  assert.equal(room.phase, 'lobby');
  assert.equal(room.version, 3);

  room = step(room, { type: 'ADVANCE', byUserId: 'u1' }, deps).room;
  assert.equal(room.phase, 'settings');
  assert.ok(room.deadline && room.deadline.token === 'phase:settings');

  for (const userId of ['u1', 'u2', 'u3']) room = step(room, { type: 'CAST_VOTE', userId, questionId: 'draft_mode', optionIds: ['standard'] }, deps).room;
  room = step(room, { type: 'ADVANCE', byUserId: 'u1' }, deps).room;
  assert.equal(room.phase, 'bans');

  const final = step(room, { type: 'ADVANCE', byUserId: 'u1' }, deps);
  assert.equal(final.room.phase, 'complete');
  assert.equal(final.room.draftType, 'standard');
  assert.deepEqual(effectTypes(final.effects), ['CLEAR_DEADLINE', 'STATE_CHANGED', 'TELEMETRY', 'SESSION_CLOSED']);
  assert.equal(final.room.deadline, null);
});

test('optimistic concurrency: a stale expectedVersion is rejected and not applied', () => {
  const deps = makeDeps();
  let room = createRoomRecord({ id: 's-opt', config: ffaConfig(), createdAt: 1 });
  room = step(room, { type: 'JOIN', userId: 'u1' }, deps).room;
  const before = room.version;
  const stale = step(room, { type: 'JOIN', userId: 'u2', expectedVersion: 999 }, deps);
  assert.equal(stale.response.ok, false);
  assert.equal(stale.response.ok === false && stale.response.code, 'STALE_VERSION');
  assert.equal(stale.room.version, before);
  assert.equal(stale.room, room); // unchanged reference
});

test('settings A2: only voters count, zero votes falls to default, approval picks most-approved', () => {
  const deps = makeDeps();
  let room = createRoomRecord({ id: 's-a2', config: ffaConfig(), createdAt: 1 });
  room = join(room, ['u1', 'u2', 'u3'], deps);
  room = step(room, { type: 'ADVANCE', byUserId: 'u1' }, deps).room;

  // duration: only u1,u2 vote 4h (u3 abstains) → the voters decide → 4h (not the '6h' default)
  room = step(room, { type: 'CAST_VOTE', userId: 'u1', questionId: 'duration', optionIds: ['4h'] }, deps).room;
  room = step(room, { type: 'CAST_VOTE', userId: 'u2', questionId: 'duration', optionIds: ['4h'] }, deps).room;
  // map (approval): seven approved by all three → wins; nobody votes draft_mode → default 'standard'
  room = step(room, { type: 'CAST_VOTE', userId: 'u1', questionId: 'map', optionIds: ['pangea', 'seven'] }, deps).room;
  room = step(room, { type: 'CAST_VOTE', userId: 'u2', questionId: 'map', optionIds: ['seven', 'high'] }, deps).room;
  room = step(room, { type: 'CAST_VOTE', userId: 'u3', questionId: 'map', optionIds: ['seven'] }, deps).room;

  room = step(room, { type: 'ADVANCE', byUserId: 'u1' }, deps).room; // resolve settings → bans
  assert.equal(room.settings.locked?.['duration'], '4h');
  assert.equal(room.settings.locked?.['map'], 'seven');
  assert.equal(room.settings.locked?.['draft_mode'], 'standard'); // zero votes → default
});

test('bans resolve by majority of all seats (D13 parity)', () => {
  const deps = makeDeps();
  let room = createRoomRecord({ id: 's-bans', config: ffaConfig(), createdAt: 1 });
  room = join(room, ['u1', 'u2', 'u3'], deps);
  room = step(room, { type: 'ADVANCE', byUserId: 'u1' }, deps).room; // settings
  room = step(room, { type: 'ADVANCE', byUserId: 'u1' }, deps).room; // bans

  // 2 of 3 ban the leader → majority (threshold 2) → banned
  room = step(room, { type: 'CAST_BAN', userId: 'u1', leaderKeys: [LEADER_KEY], civKeys: [] }, deps).room;
  room = step(room, { type: 'CAST_BAN', userId: 'u2', leaderKeys: [LEADER_KEY], civKeys: [] }, deps).room;
  room = step(room, { type: 'ADVANCE', byUserId: 'u1' }, deps).room; // resolve bans → draft
  assert.deepEqual(room.bans.resolvedLeaderKeys, [LEADER_KEY]);
  assert.deepEqual(room.bans.resolvedCivKeys, []); // civ6 has no civ bans
});

test('telemetry record carries the §B.1 keys and a reporting token (standard)', () => {
  const deps = makeDeps();
  let room = createRoomRecord({ id: 's-tel', config: ffaConfig(), createdAt: 1 });
  room = join(room, ['u1', 'u2', 'u3'], deps);
  room = step(room, { type: 'ADVANCE', byUserId: 'u1' }, deps).room;
  room = step(room, { type: 'CAST_VOTE', userId: 'u1', questionId: 'map', optionIds: ['seven'] }, deps).room;
  room = step(room, { type: 'ADVANCE', byUserId: 'u1' }, deps).room; // bans
  const final = step(room, { type: 'ADVANCE', byUserId: 'u1' }, deps); // → complete

  const telemetry = final.effects.find((e) => e.type === 'TELEMETRY');
  const closed = final.effects.find((e) => e.type === 'SESSION_CLOSED');
  assert.ok(telemetry && telemetry.type === 'TELEMETRY');
  assert.ok(closed && closed.type === 'SESSION_CLOSED');
  const record = telemetry.record;
  assert.equal(record.session_id, 's-tel');
  assert.equal(record.game, 'civ6');
  assert.equal(record.source, 'activity');
  assert.equal(record.draft_type, 'standard');
  assert.equal(record.map_type, 'seven');
  assert.equal(typeof record.started_at, 'string');
  assert.equal(record.participants.length, 3);
  assert.ok(Array.isArray(record.picks) && record.picks.length > 0);
  assert.ok(typeof closed.reportingToken === 'string' && closed.reportingToken.length > 0);
});

test('snake: interactive draft drives to completion via timeouts and produces per-seat picks', () => {
  const deps = makeDeps();
  let room = createRoomRecord({ id: 's-snake', config: ffaConfig(['snake']), createdAt: 1 });
  room = join(room, ['u1', 'u2', 'u3'], deps);
  room = step(room, { type: 'ADVANCE', byUserId: 'u1' }, deps).room; // settings
  room = step(room, { type: 'ADVANCE', byUserId: 'u1' }, deps).room; // bans
  room = step(room, { type: 'ADVANCE', byUserId: 'u1' }, deps).room; // draft (snake)
  assert.equal(room.phase, 'draft');
  assert.ok(room.draft.kind === 'interactive' && room.draft.state.kind === 'snake');

  let last = { room, effects: [] as SessionEffect[] };
  let guard = 0;
  while (room.phase === 'draft' && guard++ < 200) {
    const token = room.deadline?.token;
    if (!token) break;
    last = step(room, { type: 'TIMEOUT', token }, deps);
    room = last.room;
  }
  assert.equal(room.phase, 'complete');
  const telemetry = last.effects.find((e) => e.type === 'TELEMETRY');
  assert.ok(telemetry && telemetry.type === 'TELEMETRY');
  assert.equal(telemetry.record.picks.length, 3);
});

test('blind: staged + submitted picks complete the draft with correct per-seat picks and token', () => {
  const deps = makeDeps();
  let room = createRoomRecord({ id: 's-blind', config: ffaConfig(['blind']), createdAt: 1 });
  room = join(room, ['u1', 'u2', 'u3'], deps);
  room = step(room, { type: 'ADVANCE', byUserId: 'u1' }, deps).room; // settings
  room = step(room, { type: 'ADVANCE', byUserId: 'u1' }, deps).room; // bans
  room = step(room, { type: 'ADVANCE', byUserId: 'u1' }, deps).room; // draft (blind)

  let last = { room, effects: [] as SessionEffect[] };
  for (const seatId of ['u1', 'u2', 'u3']) {
    assert.ok(room.draft.kind === 'interactive' && room.draft.state.kind === 'blind');
    const pick = room.draft.state.pools[seatId].leaders[0];
    room = step(room, { type: 'STAGE_PICK', userId: seatId, pickType: 'leader', key: pick }, deps).room;
    last = step(room, { type: 'SUBMIT_PICK', userId: seatId }, deps);
    room = last.room;
  }
  assert.equal(room.phase, 'complete');
  const closed = last.effects.find((e) => e.type === 'SESSION_CLOSED');
  assert.ok(closed && closed.type === 'SESSION_CLOSED' && typeof closed.reportingToken === 'string' && closed.reportingToken.length > 0);
});

test('blind timeout: no auto-assignment (legacy parity) — completes with the picks that exist', () => {
  const deps = makeDeps();
  let room = createRoomRecord({ id: 's-blind-to', config: ffaConfig(['blind']), createdAt: 1 });
  room = join(room, ['u1', 'u2'], deps);
  room = step(room, { type: 'ADVANCE', byUserId: 'u1' }, deps).room;
  room = step(room, { type: 'ADVANCE', byUserId: 'u1' }, deps).room;
  room = step(room, { type: 'ADVANCE', byUserId: 'u1' }, deps).room; // draft (blind)
  const token = room.deadline?.token as string;
  const final = step(room, { type: 'TIMEOUT', token }, deps);
  assert.equal(final.room.phase, 'complete');
  const telemetry = final.effects.find((e) => e.type === 'TELEMETRY');
  assert.ok(telemetry && telemetry.type === 'TELEMETRY');
  // no picks submitted → picks present but leaders null (faithful; not auto-filled)
  assert.ok(telemetry.record.picks.every((p) => (p as { leader_id: string | null }).leader_id === null));
});

test('randomize fills only unanswered questions; hand-picked votes are preserved', () => {
  const deps = makeDeps();
  let room = createRoomRecord({ id: 's-rand', config: ffaConfig(['standard', 'snake']), createdAt: 1 });
  room = join(room, ['u1', 'u2'], deps);
  room = step(room, { type: 'ADVANCE', byUserId: 'u1' }, deps).room;
  room = step(room, { type: 'CAST_VOTE', userId: 'u1', questionId: 'duration', optionIds: ['4h'] }, deps).room;
  room = step(room, { type: 'RANDOMIZE_BALLOT', userId: 'u1' }, deps).room;
  assert.equal(room.settings.ballots['duration']?.['u1'], '4h'); // preserved
  assert.notEqual(room.settings.ballots['map']?.['u1'], undefined); // filled
  assert.notEqual(room.settings.ballots['draft_mode']?.['u1'], undefined); // filled
});

test('locked ballot: a ready seat cannot cast further votes', () => {
  const deps = makeDeps();
  let room = createRoomRecord({ id: 's-lock', config: ffaConfig(), createdAt: 1 });
  room = join(room, ['u1', 'u2'], deps);
  room = step(room, { type: 'ADVANCE', byUserId: 'u1' }, deps).room;
  room = step(room, { type: 'SET_READY', userId: 'u1', ready: true }, deps).room;
  const rejected = step(room, { type: 'CAST_VOTE', userId: 'u1', questionId: 'duration', optionIds: ['4h'] }, deps);
  assert.equal(rejected.response.ok, false);
  assert.equal(rejected.response.ok === false && rejected.response.code, 'LOCKED');
});

test('all-ready auto-advances the phase; a single ready seat does not', () => {
  const deps = makeDeps();
  let room = createRoomRecord({ id: 's-auto', config: ffaConfig(), createdAt: 1 });
  room = join(room, ['u1', 'u2'], deps);
  room = step(room, { type: 'SET_READY', userId: 'u1', ready: true }, deps).room;
  assert.equal(room.phase, 'lobby');
  const advanced = step(room, { type: 'SET_READY', userId: 'u2', ready: true }, deps);
  assert.equal(advanced.room.phase, 'settings');
  assert.ok(advanced.effects.some((e) => e.type === 'SET_DEADLINE'));
});

test('non-host advance and cancel are rejected; the host may cancel', () => {
  const deps = makeDeps();
  let room = createRoomRecord({ id: 's-host', config: ffaConfig(), createdAt: 1 });
  room = join(room, ['u1', 'u2'], deps);
  assert.equal(step(room, { type: 'ADVANCE', byUserId: 'u2' }, deps).response.ok, false);
  assert.equal(step(room, { type: 'CANCEL', reason: 'x', byUserId: 'u2' }, deps).response.ok, false);
  assert.equal(step(room, { type: 'CANCEL', reason: 'x', byUserId: 'u1' }, deps).response.ok, true);
});

test('stale timeout is a no-op: no effects, no version bump, same reference', () => {
  const deps = makeDeps();
  let room = createRoomRecord({ id: 's-stale', config: ffaConfig(), createdAt: 1 });
  room = join(room, ['u1', 'u2'], deps);
  room = step(room, { type: 'ADVANCE', byUserId: 'u1' }, deps).room; // settings, deadline 'phase:settings'
  const before = room.version;
  const noop = step(room, { type: 'TIMEOUT', token: 'turn:999' }, deps);
  assert.equal(noop.response.ok, true);
  assert.equal(noop.effects.length, 0);
  assert.equal(noop.room.version, before);
  assert.equal(noop.room, room);
});

test('cancel mid interactive draft cancels the engine session and closes', () => {
  const deps = makeDeps();
  let room = createRoomRecord({ id: 's-cancel', config: ffaConfig(['snake']), createdAt: 1 });
  room = join(room, ['u1', 'u2'], deps);
  room = step(room, { type: 'ADVANCE', byUserId: 'u1' }, deps).room;
  room = step(room, { type: 'ADVANCE', byUserId: 'u1' }, deps).room;
  room = step(room, { type: 'ADVANCE', byUserId: 'u1' }, deps).room; // draft
  const cancelled = step(room, { type: 'CANCEL', reason: 'host-abort', byUserId: 'u1' }, deps);
  assert.equal(cancelled.room.phase, 'cancelled');
  assert.equal(cancelled.room.cancelReason, 'host-abort');
  assert.ok(cancelled.room.draft.kind === 'interactive' && cancelled.room.draft.state.status === 'cancelled');
  assert.ok(cancelled.effects.some((e) => e.type === 'SESSION_CLOSED'));
});

test('cwc / Teamer: enters the captains round and drives to completion', () => {
  const deps = makeDeps();
  let room = createRoomRecord({
    id: 's-cwc',
    config: { edition: 'CIV6', source: 'activity', mode: 'teamers', gameType: 'Teamer', numberTeams: 2, guildId: 'g', hostId: 'u1', voteConfig: voteConfig(['cwc']) },
    createdAt: 1,
  });
  room = join(room, ['u1', 'u2', 'u3', 'u4'], deps);
  room = step(room, { type: 'ADVANCE', byUserId: 'u1' }, deps).room; // settings
  room = step(room, { type: 'ADVANCE', byUserId: 'u1' }, deps).room; // bans
  room = step(room, { type: 'ADVANCE', byUserId: 'u1' }, deps).room; // draft (cwc)
  assert.equal(room.draftType, 'cwc');
  assert.ok(room.draft.kind === 'interactive' && room.draft.state.kind === 'cwc' && room.draft.state.round === 'captains');

  let guard = 0;
  while (room.phase === 'draft' && guard++ < 400) {
    const token = room.deadline?.token;
    if (!token) break;
    room = step(room, { type: 'TIMEOUT', token }, deps).room;
  }
  assert.equal(room.phase, 'complete');
});

test('normalizeRoomRecord rejects malformed input and reconstructs a valid record', async () => {
  const { normalizeRoomRecord } = await import('../../src/session/domain.js');
  assert.equal(normalizeRoomRecord(null), null);
  assert.equal(normalizeRoomRecord({ id: 'x' }), null); // missing version
  const room = createRoomRecord({ id: 's-norm', config: ffaConfig(), createdAt: 42 });
  const round = normalizeRoomRecord(JSON.parse(JSON.stringify(room)));
  assert.ok(round);
  assert.equal(round.id, 's-norm');
  assert.equal(round.phase, 'lobby');
  assert.equal(round.createdAt, 42);
});
