import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createRoomRecord, processSessionCommand } from '../../src/session/domain.js';
import type { RoomRecord, RoomConfig, SessionDeps } from '../../src/session/domain.js';
import { projectRoom, projectEvents } from '../../src/session/projection.js';
import type { RoomSnapshot } from '../../src/session/projection.js';
import { createSeededRandom, publicEvent, seatEvent } from '../../src/engine/index.js';
import type { GameVoteConfig } from '../../src/shared/vote.types.js';

const NOW = 1_700_000_000_000;
function makeDeps(seed = 'projection-test'): SessionDeps {
  return { now: () => NOW, rng: createSeededRandom(seed) };
}
function config(draftMode: string, gameType: RoomConfig['gameType'] = 'FFA'): RoomConfig {
  const voteConfig: GameVoteConfig = { questions: [{ id: 'draft_mode', title: 'M', defaultOptionId: draftMode, options: [{ id: draftMode, label: draftMode }] }] };
  return { edition: 'CIV6', source: 'activity', mode: 'ffa', gameType, guildId: 'g', hostId: 'u1', voteConfig };
}
const P = (room: RoomRecord, command: Parameters<typeof processSessionCommand>[1], deps: SessionDeps) => processSessionCommand(room, command, deps).room;

/** Build a blind draft where u1 committed and u2/u3 only staged (so all private buckets are populated). */
function blindMidDraft(deps: SessionDeps): RoomRecord {
  let room = createRoomRecord({ id: 'proj-blind', config: config('blind'), createdAt: 1 });
  for (const userId of ['u1', 'u2', 'u3']) room = P(room, { type: 'JOIN', userId }, deps);
  room = P(room, { type: 'ADVANCE', byUserId: 'u1' }, deps);
  room = P(room, { type: 'ADVANCE', byUserId: 'u1' }, deps);
  room = P(room, { type: 'ADVANCE', byUserId: 'u1' }, deps); // draft (blind)
  for (const seatId of ['u1', 'u2', 'u3']) {
    if (room.draft.kind !== 'interactive' || room.draft.state.kind !== 'blind') throw new Error('expected blind');
    const pick = room.draft.state.pools[seatId].leaders[0];
    room = P(room, { type: 'STAGE_PICK', userId: seatId, pickType: 'leader', key: pick }, deps);
  }
  room = P(room, { type: 'SUBMIT_PICK', userId: 'u1' }, deps); // u1 commits; u2/u3 only staged
  return room;
}

function asSnapshot(result: ReturnType<typeof projectRoom>): RoomSnapshot {
  assert.ok(!('error' in result), 'expected a snapshot, got an error');
  return result;
}

test('seat projection censors blind pools, staged, and committed picks to the recipient only', () => {
  const room = blindMidDraft(makeDeps());
  const snap = asSnapshot(projectRoom(room, { kind: 'seat', seatId: 'u1' }));
  assert.ok(snap.draft.kind === 'interactive' && snap.draft.state.kind === 'blind');
  const state = snap.draft.state;
  assert.deepEqual(Object.keys(state.pools), ['u1']);
  assert.ok(Object.keys(state.staged).every((s) => s === 'u1'));
  assert.ok(Object.keys(state.picks).every((s) => s === 'u1')); // blind picks hidden until complete
});

test('seat projection censors ballots and ban submissions to the recipient only', () => {
  const deps = makeDeps();
  let room = createRoomRecord({ id: 'proj-votes', config: config('standard'), createdAt: 1 });
  for (const userId of ['u1', 'u2']) room = P(room, { type: 'JOIN', userId }, deps);
  room = P(room, { type: 'ADVANCE', byUserId: 'u1' }, deps); // settings
  room = P(room, { type: 'CAST_VOTE', userId: 'u1', questionId: 'draft_mode', optionIds: ['standard'] }, deps);
  room = P(room, { type: 'CAST_VOTE', userId: 'u2', questionId: 'draft_mode', optionIds: ['standard'] }, deps);
  const snap = asSnapshot(projectRoom(room, { kind: 'seat', seatId: 'u1' }));
  for (const bucket of Object.values(snap.settings.ballots)) {
    assert.deepEqual(Object.keys(bucket), ['u1']);
  }
});

test('observer projection is uncensored (staff god-view)', () => {
  const room = blindMidDraft(makeDeps());
  const snap = asSnapshot(projectRoom(room, { kind: 'observer', userId: 'staff-1' }));
  assert.ok(snap.draft.kind === 'interactive' && snap.draft.state.kind === 'blind');
  assert.equal(Object.keys(snap.draft.state.pools).length, 3);
});

test('seat identity beats staff: an observer request for a seated user is refused', () => {
  const room = blindMidDraft(makeDeps());
  const refused = projectRoom(room, { kind: 'observer', userId: 'u2' });
  assert.deepEqual(refused, { error: 'OBSERVER_IS_SEATED' });
  // an anonymous / non-seated observer is allowed
  assert.ok(!('error' in projectRoom(room, { kind: 'observer' })));
});

test('public config subset excludes internal tuning fields', () => {
  const room = blindMidDraft(makeDeps());
  const snap = asSnapshot(projectRoom(room, { kind: 'seat', seatId: 'u1' }));
  assert.ok(!('timers' in snap.config));
  assert.ok(!('phaseTimersMs' in snap.config));
  assert.ok(!('voiceChannelId' in snap.config));
  assert.equal(snap.config.hostId, 'u1');
});

test('projectEvents: a seat sees public + own seat events; an observer sees all', () => {
  const events = [
    publicEvent('ORDER_SET', { order: ['u1', 'u2'], note: 'x' }),
    seatEvent('STAGE_UPDATED', 'u1', { seatId: 'u1', staged: { leaderKey: 'L' } }),
    seatEvent('STAGE_UPDATED', 'u2', { seatId: 'u2', staged: { leaderKey: 'M' } }),
  ];
  const seatView = projectEvents(events, { kind: 'seat', seatId: 'u1' });
  assert.equal(seatView.length, 2);
  assert.ok(seatView.every((e) => e.visibility === 'public' || e.visibility.seatId === 'u1'));
  assert.equal(projectEvents(events, { kind: 'observer' }).length, 3);
});

test('snake board (order/pools/picks) is public to a seat; only staged is private', () => {
  const deps = makeDeps();
  let room = createRoomRecord({ id: 'proj-snake', config: config('snake'), createdAt: 1 });
  for (const userId of ['u1', 'u2']) room = P(room, { type: 'JOIN', userId }, deps);
  room = P(room, { type: 'ADVANCE', byUserId: 'u1' }, deps);
  room = P(room, { type: 'ADVANCE', byUserId: 'u1' }, deps);
  room = P(room, { type: 'ADVANCE', byUserId: 'u1' }, deps); // draft (snake)
  const snap = asSnapshot(projectRoom(room, { kind: 'seat', seatId: 'u2' }));
  assert.ok(snap.draft.kind === 'interactive' && snap.draft.state.kind === 'snake');
  assert.equal(snap.draft.state.order.length, 2);
  assert.ok(snap.draft.state.leaderPool.length > 0);
});
