import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isDraftInputError } from '../../../src/engine/draft/errors.js';
import {
  getAvailableCiv6LeaderKeys,
  getAvailableCiv7CivKeys,
} from '../../../src/engine/draft/pools.js';
import { ENGINE_DRAFT_TIMERS_MS } from '../../../src/engine/draft/constants.js';
import { createDraftSession, processDraftInput } from '../../../src/engine/draft/machine.js';
import type { DraftResult } from '../../../src/engine/draft/machine.js';
import { createSeededRandom } from '../../../src/engine/random.js';
import type { RandomSource } from '../../../src/engine/random.js';
import type {
  BlindDraftState,
  CwcDraftState,
  DraftEngineInput,
  DraftSessionConfig,
  DraftSessionState,
  SnakeDraftState,
} from '../../../src/engine/types.js';

const baseConfig: Omit<DraftSessionConfig, 'edition' | 'gameType' | 'seatIds'> = {
  sessionId: 's1',
  voteUuid: 'v1',
  hostId: 'u1',
  bannedLeaderKeys: [],
  bannedCivKeys: [],
};

function step(state: DraftSessionState, input: DraftEngineInput, rng: RandomSource): DraftResult {
  const result = processDraftInput(state, input, rng);
  assert.ok(!isDraftInputError(result), `unexpected error: ${JSON.stringify(result)}`);
  return result;
}

function expectNotice(state: DraftSessionState, input: DraftEngineInput, rng: RandomSource, message: string): void {
  const result = processDraftInput(state, input, rng);
  assert.ok(isDraftInputError(result), `expected "${message}"`);
  assert.equal(result.error.message, message);
}

function expectCreateError(fn: () => unknown, message: string): void {
  let thrown: unknown;
  try {
    fn();
  } catch (err: unknown) {
    thrown = err;
  }
  assert.ok(thrown instanceof Error, `expected create-time throw "${message}"`);
  assert.equal(thrown.message, message);
}

// ── blind ────────────────────────────────────────────────────

test('blind: CIV7 full path — censored pools, staging, resubmission, reveal on completion', () => {
  const rng = createSeededRandom('blind-1');
  const seatIds = ['u1', 'u2', 'u3', 'u4'];
  const created = createDraftSession('blind', {
    ...baseConfig,
    edition: 'CIV7',
    startingAge: 'Antiquity_Age',
    gameType: 'FFA',
    seatIds,
  }, rng);

  const poolEvents = created.events.filter((event) => event.type === 'POOLS_DEALT');
  assert.equal(poolEvents.length, 4);
  for (const event of poolEvents) {
    assert.notEqual(event.visibility, 'public');
    assert.ok(event.visibility !== 'public' && event.visibility.seatId === event.seatId, 'pools censored to owner');
    assert.ok(event.pools.leaders.length > 0 && (event.pools.civs?.length ?? 0) > 0);
  }
  assert.ok(created.events.some((event) => event.type === 'DEADLINE_SET' && event.durationMs === ENGINE_DRAFT_TIMERS_MS.blind));

  let state = created.state as BlindDraftState;
  const poolU1 = state.pools['u1'] as { leaders: readonly string[]; civs?: readonly string[] };

  expectNotice(state, { type: 'STAGE', seatId: 'intruder', pickType: 'leader', key: 'X' }, rng, '⚠️ You are not part of this blind draft.');
  expectNotice(state, { type: 'STAGE', seatId: 'u1', pickType: 'leader', key: 'NOT_IN_POOL' }, rng, '⚠️ That choice is not available in your blind draft pool.');
  expectNotice(state, { type: 'STAGE', seatId: 'u1', pickType: 'civ', key: 'NOT_IN_POOL' }, rng, '⚠️ That choice is not available in your blind draft pool.');
  expectNotice(state, { type: 'SUBMIT', seatId: 'u1' }, rng, '⚠️ Pick all required options before submitting.');
  expectNotice(state, { type: 'PICK', seatId: 'u1', key: 'X', turnToken: 0 }, rng, '⚠️ Blind draft is not currently accepting that action.');

  state = step(state, { type: 'STAGE', seatId: 'u1', pickType: 'leader', key: poolU1.leaders[0] as string }, rng).state as BlindDraftState;
  expectNotice(state, { type: 'SUBMIT', seatId: 'u1' }, rng, '⚠️ Pick all required options before submitting.');
  state = step(state, { type: 'STAGE', seatId: 'u1', pickType: 'civ', key: (poolU1.civs ?? [])[0] as string }, rng).state as BlindDraftState;
  const firstSubmit = step(state, { type: 'SUBMIT', seatId: 'u1' }, rng);
  state = firstSubmit.state as BlindDraftState;
  assert.ok(firstSubmit.events.some((event) => event.type === 'PICK_COMMITTED' && event.seatId === 'u1' && !event.auto));
  assert.ok(firstSubmit.events.some((event) => event.type === 'PROGRESS_CHANGED'));
  assert.equal(state.status, 'active');

  // resubmission overwrite allowed until finalize (legacy parity)
  state = step(state, { type: 'STAGE', seatId: 'u1', pickType: 'leader', key: poolU1.leaders[1] as string }, rng).state as BlindDraftState;
  state = step(state, { type: 'SUBMIT', seatId: 'u1' }, rng).state as BlindDraftState;
  assert.equal(state.picks['u1']?.leaderKey, poolU1.leaders[1]);

  for (const seatId of ['u2', 'u3']) {
    const pool = state.pools[seatId] as { leaders: readonly string[]; civs?: readonly string[] };
    state = step(state, { type: 'STAGE', seatId, pickType: 'leader', key: pool.leaders[0] as string }, rng).state as BlindDraftState;
    state = step(state, { type: 'STAGE', seatId, pickType: 'civ', key: (pool.civs ?? [])[0] as string }, rng).state as BlindDraftState;
    state = step(state, { type: 'SUBMIT', seatId }, rng).state as BlindDraftState;
  }

  const poolU4 = state.pools['u4'] as { leaders: readonly string[]; civs?: readonly string[] };
  state = step(state, { type: 'STAGE', seatId: 'u4', pickType: 'leader', key: poolU4.leaders[0] as string }, rng).state as BlindDraftState;
  state = step(state, { type: 'STAGE', seatId: 'u4', pickType: 'civ', key: (poolU4.civs ?? [])[0] as string }, rng).state as BlindDraftState;
  const done = step(state, { type: 'SUBMIT', seatId: 'u4' }, rng);
  const doneState = done.state as BlindDraftState;
  assert.equal(doneState.status, 'complete');
  assert.equal(doneState.completionReason, 'complete');
  const reveal = done.events.find((event) => event.type === 'PICKS_REVEALED');
  assert.ok(reveal && reveal.type === 'PICKS_REVEALED' && reveal.reason === 'complete' && reveal.visibility === 'public');
  assert.ok(done.events.some((event) => event.type === 'DRAFT_COMPLETED' && event.reason === 'complete'));

  expectNotice(doneState, { type: 'SUBMIT', seatId: 'u1' }, rng, '⚠️ Blind draft is not active.');
  expectNotice(doneState, { type: 'CANCEL', reason: 'late' }, rng, '⚠️ Blind draft is not active.');
});

test('blind: timeout reveals partial picks with NO auto-assign (legacy parity); CIV6 leader-only readiness', () => {
  const rng = createSeededRandom('blind-2');
  const created = createDraftSession('blind', {
    ...baseConfig,
    edition: 'CIV6',
    gameType: 'FFA',
    seatIds: ['u1', 'u2'],
  }, rng);
  let state = created.state as BlindDraftState;
  const poolU1 = state.pools['u1'] as { leaders: readonly string[] };
  state = step(state, { type: 'STAGE', seatId: 'u1', pickType: 'leader', key: poolU1.leaders[0] as string }, rng).state as BlindDraftState;
  state = step(state, { type: 'SUBMIT', seatId: 'u1' }, rng).state as BlindDraftState;

  const timedOut = step(state, { type: 'TIMEOUT' }, rng);
  const timedOutState = timedOut.state as BlindDraftState;
  assert.equal(timedOutState.status, 'complete');
  assert.equal(timedOutState.completionReason, 'timeout');
  const reveal = timedOut.events.find((event) => event.type === 'PICKS_REVEALED');
  assert.ok(reveal && reveal.type === 'PICKS_REVEALED');
  assert.deepEqual(Object.keys(reveal.picks), ['u1'], 'u2 must not be auto-assigned');
});

test('blind: create-time validation wraps allocation errors; synthetic missing-pool + picks-fallback branches', () => {
  const rng = createSeededRandom('blind-3');
  // D15: blind is FFA/Duel only — the game-type gate fires before allocation
  expectCreateError(
    () => createDraftSession('blind', { ...baseConfig, edition: 'CIV6', gameType: 'Teamer', numberTeams: 2, seatIds: ['u1', 'u2'] }, rng),
    'Blind draft is only available for FFA or Duel votes.',
  );
  // and allocation errors still surface for legal game types
  expectCreateError(
    () => createDraftSession('blind', { ...baseConfig, edition: 'CIV6', gameType: 'FFA', seatIds: ['u1'] }, rng),
    'For FFA, number-players must be at least 2.',
  );

  const created = createDraftSession('blind', {
    ...baseConfig,
    edition: 'CIV6',
    gameType: 'FFA',
    seatIds: ['u1', 'u2'],
    timers: { blind: 5_000 },
  }, rng);
  const base = created.state as BlindDraftState;
  assert.equal(base.timers.blind, 5_000, 'timer override applied');
  assert.equal(base.timers.snakePick, ENGINE_DRAFT_TIMERS_MS.snakePick, 'other timers defaulted');

  // synthetic: seat member without a dealt pool
  const missingPool: BlindDraftState = structuredClone(base);
  (missingPool as { seatIds: readonly string[] }).seatIds = ['u1', 'u2', 'u9'];
  expectNotice(missingPool, { type: 'STAGE', seatId: 'u9', pickType: 'leader', key: 'X' }, rng, '⚠️ Blind draft options are unavailable.');

  // synthetic: committed picks with cleared staging — SUBMIT falls back to picks
  const pool = base.pools['u1'] as { leaders: readonly string[] };
  const withPicks: BlindDraftState = structuredClone(base);
  withPicks.picks['u1'] = { leaderKey: pool.leaders[0] as string };
  const resubmitted = step(withPicks, { type: 'SUBMIT', seatId: 'u1' }, rng);
  assert.equal((resubmitted.state as BlindDraftState).picks['u1']?.leaderKey, pool.leaders[0]);
  // and STAGE seeds from picks when staged is empty
  const staged = step(withPicks, { type: 'STAGE', seatId: 'u1', pickType: 'leader', key: pool.leaders[1] as string }, rng);
  assert.equal((staged.state as BlindDraftState).staged['u1']?.leaderKey, pool.leaders[1]);

  // synthetic: staged pick referencing a key outside the pool fails SUBMIT re-validation
  const tampered: BlindDraftState = structuredClone(base);
  tampered.staged['u1'] = { leaderKey: 'NOT_IN_POOL' };
  expectNotice(tampered, { type: 'SUBMIT', seatId: 'u1' }, rng, '⚠️ That choice is not available in your blind draft pool.');
});

// ── snake ────────────────────────────────────────────────────

test('snake: CIV7 — reversed civ order, unique leaders, duplicate civs, auto-pick timeout, stale token', () => {
  const rng = createSeededRandom('snake-1');
  const seatIds = ['u1', 'u2', 'u3'];
  const created = createDraftSession('snake', {
    ...baseConfig,
    edition: 'CIV7',
    startingAge: 'Antiquity_Age',
    gameType: 'FFA',
    seatIds,
  }, rng);
  let state = created.state as SnakeDraftState;

  assert.deepEqual([...state.civOrder], [...state.order].reverse(), 'civ order is leader order reversed');
  const orderEvent = created.events.find((event) => event.type === 'ORDER_SET');
  assert.ok(orderEvent && orderEvent.type === 'ORDER_SET' && orderEvent.note === 'Initial order randomized.');
  const firstTurn = created.events.find((event) => event.type === 'TURN_STARTED');
  assert.ok(firstTurn && firstTurn.type === 'TURN_STARTED' && firstTurn.seatId === state.order[0] && firstTurn.round === 'leader');

  const first = state.order[0] as string;
  const notFirst = seatIds.find((seatId) => seatId !== first) as string;

  expectNotice(state, { type: 'SUBMIT', seatId: first, turnToken: 999 }, rng, '⚠️ This pick prompt has expired.');
  expectNotice(state, { type: 'STAGE', seatId: notFirst, pickType: 'leader', key: 'X', turnToken: state.turnToken }, rng, '⚠️ It is not your turn to pick.');
  expectNotice(state, { type: 'STAGE', seatId: first, pickType: 'civ', key: 'X', turnToken: state.turnToken }, rng, '⚠️ That pick prompt is no longer active.');
  expectNotice(state, { type: 'SUBMIT', seatId: first, turnToken: state.turnToken }, rng, '⚠️ Choose a pick before submitting.');
  expectNotice(state, { type: 'STAGE', seatId: first, pickType: 'leader', key: 'NOT_A_LEADER', turnToken: state.turnToken }, rng, '⚠️ That choice is no longer available.');
  expectNotice(state, { type: 'PICK', seatId: first, key: 'X', turnToken: state.turnToken }, rng, '⚠️ Snake draft is not currently accepting that action.');
  expectNotice(state, { type: 'SELECT_CAPTAIN', byUserId: 'u1', teamIndex: 0, userId: 'u2' }, rng, '⚠️ Snake draft is not currently accepting that action.');

  // turnToken omitted → staleness check skipped (legacy DM flow without token)
  state = step(state, { type: 'STAGE', seatId: first, pickType: 'leader', key: state.leaderPool[0] as string }, rng).state as SnakeDraftState;
  state = step(state, { type: 'SUBMIT', seatId: first, turnToken: state.turnToken }, rng).state as SnakeDraftState;
  assert.equal(state.picks[first]?.leaderKey, state.leaderPool[0]);

  const autoPicked = step(state, { type: 'TIMEOUT' }, rng);
  state = autoPicked.state as SnakeDraftState;
  assert.ok(autoPicked.events.some((event) => event.type === 'AUTO_PICK_APPLIED' && event.round === 'leader'));
  assert.ok(autoPicked.events.some((event) => event.type === 'PICK_COMMITTED' && event.auto));

  const third = state.order[2] as string;
  const taken = new Set(Object.values(state.picks).map((pick) => pick.leaderKey));
  const remainingLeader = state.leaderPool.find((key) => !taken.has(key)) as string;
  state = step(state, { type: 'STAGE', seatId: third, pickType: 'leader', key: remainingLeader, turnToken: state.turnToken }, rng).state as SnakeDraftState;
  const flipped = step(state, { type: 'SUBMIT', seatId: third, turnToken: state.turnToken }, rng);
  state = flipped.state as SnakeDraftState;
  assert.equal(state.round, 'civ');
  assert.equal(state.turnIndex, 0);
  const civTurn = flipped.events.find((event) => event.type === 'TURN_STARTED');
  assert.ok(civTurn && civTurn.type === 'TURN_STARTED' && civTurn.seatId === state.civOrder[0] && civTurn.round === 'civ');

  const sharedCiv = state.civPool[0] as string;
  for (let i = 0; i < 3; i += 1) {
    const seatId = state.civOrder[i] as string;
    state = step(state, { type: 'STAGE', seatId, pickType: 'civ', key: sharedCiv, turnToken: state.turnToken }, rng).state as SnakeDraftState;
    state = step(state, { type: 'SUBMIT', seatId, turnToken: state.turnToken }, rng).state as SnakeDraftState;
  }
  assert.equal(state.status, 'complete');
  assert.ok(Object.values(state.picks).every((pick) => pick.civKey === sharedCiv), 'civ duplicates allowed');
  const leaders = Object.values(state.picks).map((pick) => pick.leaderKey);
  assert.equal(new Set(leaders).size, leaders.length, 'leaders unique');
  expectNotice(state, { type: 'SUBMIT', seatId: first }, rng, '⚠️ Snake draft is not active.');
});

test('snake: CIV6 single leader round; create-time validation and pool errors', () => {
  const rng = createSeededRandom('snake-2');
  expectCreateError(
    () => createDraftSession('snake', { ...baseConfig, edition: 'CIV6', gameType: 'Teamer', numberTeams: 2, seatIds: ['u1', 'u2'] }, rng),
    'Snake draft is only available for FFA or Duel votes.',
  );
  expectCreateError(
    () => createDraftSession('snake', {
      ...baseConfig,
      edition: 'CIV6',
      gameType: 'FFA',
      seatIds: Array.from({ length: 200 }, (_, index) => `u${index}`),
    }, rng),
    'Not enough leaders remain after bans for snake draft.',
  );
});

test('snake: CIV7 create fails when no civs remain; CIV6 completes without a civ round', () => {
  const rng = createSeededRandom('snake-3');
  const allAntiquity = getAvailableCiv7CivKeys({ startingAge: 'Antiquity_Age', banned: new Set() });
  expectCreateError(
    () => createDraftSession('snake', {
      ...baseConfig,
      edition: 'CIV7',
      startingAge: 'Antiquity_Age',
      gameType: 'Duel',
      seatIds: ['u1', 'u2'],
      bannedCivKeys: allAntiquity,
    }, rng),
    'No civs remain after bans for snake draft.',
  );

  const created = createDraftSession('snake', { ...baseConfig, edition: 'CIV6', gameType: 'Duel', seatIds: ['u1', 'u2'] }, rng);
  let state = created.state as SnakeDraftState;
  for (let i = 0; i < 2; i += 1) {
    const seatId = state.order[i] as string;
    const taken = new Set(Object.values(state.picks).map((pick) => pick.leaderKey));
    const key = state.leaderPool.find((candidate) => !taken.has(candidate)) as string;
    state = step(state, { type: 'STAGE', seatId, pickType: 'leader', key, turnToken: state.turnToken }, rng).state as SnakeDraftState;
    state = step(state, { type: 'SUBMIT', seatId, turnToken: state.turnToken }, rng).state as SnakeDraftState;
  }
  assert.equal(state.status, 'complete', 'CIV6 has no civ round');
});

test('snake: synthetic states — no-pool close, missing picker, TIMEOUT/SUBMIT on stale rounds, CANCEL', () => {
  const rng = createSeededRandom('snake-4');
  const created = createDraftSession('snake', { ...baseConfig, edition: 'CIV6', gameType: 'FFA', seatIds: ['u1', 'u2', 'u3'] }, rng);
  const base = created.state as SnakeDraftState;

  // exhausted pool at TIMEOUT → SESSION_CLOSED_NO_POOL (legacy 'no valid picks remained' close)
  const exhausted: SnakeDraftState = structuredClone(base);
  (exhausted as { leaderPool: readonly string[] }).leaderPool = [base.leaderPool[0] as string];
  exhausted.picks[base.order[0] as string] = { leaderKey: base.leaderPool[0] as string };
  exhausted.turnIndex = 1;
  const closed = step(exhausted, { type: 'TIMEOUT' }, rng);
  const closedState = closed.state as SnakeDraftState;
  assert.equal(closedState.status, 'complete');
  assert.equal(closedState.completionNote, 'no-pool');
  assert.ok(closed.events.some((event) => event.type === 'SESSION_CLOSED_NO_POOL'
    && event.message === 'Snake draft closed because no valid picks remained.'));
  assert.ok(closed.events.some((event) => event.type === 'DRAFT_COMPLETED' && event.reason === 'no-pool'));

  // restored state with an out-of-range turn index → TIMEOUT is a no-op
  const noPicker: SnakeDraftState = structuredClone(base);
  noPicker.turnIndex = 99;
  const noop = step(noPicker, { type: 'TIMEOUT' }, rng);
  assert.deepEqual(noop.events, []);

  // restored state stuck on a finished round but still active → guards fire
  const staleRound: SnakeDraftState = structuredClone(base);
  (staleRound as { round: SnakeDraftState['round'] }).round = 'complete';
  const staleTimeout = step(staleRound, { type: 'TIMEOUT' }, rng);
  assert.deepEqual(staleTimeout.events, []);
  expectNotice(staleRound, { type: 'SUBMIT', seatId: 'u1', turnToken: staleRound.turnToken }, rng, '⚠️ It is not your turn to pick.');

  // CANCEL on an active session
  const cancelled = step(base, { type: 'CANCEL', reason: 'host cancelled' }, rng);
  const cancelledState = cancelled.state as SnakeDraftState;
  assert.equal(cancelledState.status, 'cancelled');
  assert.equal(cancelledState.cancelReason, 'host cancelled');
  assert.ok(cancelled.events.some((event) => event.type === 'DRAFT_CANCELLED' && event.reason === 'host cancelled'));
  expectNotice(cancelledState, { type: 'SUBMIT', seatId: 'u1' }, rng, '⚠️ Snake draft is not active.');
});

// ── cwc ──────────────────────────────────────────────────────

test('cwc: captain selection, pick order [0,1,1,0], guard notices, auto timeout, duplicate civs', () => {
  const rng = createSeededRandom('cwc-1');
  const seatIds = ['u1', 'u2', 'u3', 'u4'];
  const created = createDraftSession('cwc', {
    ...baseConfig,
    edition: 'CIV7',
    startingAge: 'Antiquity_Age',
    gameType: 'Teamer',
    numberTeams: 2,
    seatIds,
  }, rng);
  let state = created.state as CwcDraftState;
  assert.deepEqual([...state.pickOrder], [0, 1, 1, 0]);
  assert.ok(created.events.some((event) => event.type === 'DEADLINE_SET' && event.deadlineKind === 'captains'));

  expectNotice(state, { type: 'SELECT_CAPTAIN', byUserId: 'u2', teamIndex: 0, userId: 'u2' }, rng, '⚠️ Only the vote host can select captains.');
  expectNotice(state, { type: 'SELECT_CAPTAIN', byUserId: 'u1', teamIndex: 0, userId: 'ghost' }, rng, '⚠️ Captains must be members of this vote.');
  expectNotice(state, { type: 'PICK', seatId: 'u1', key: 'X', turnToken: 0 }, rng, '⚠️ CWC draft is not currently accepting picks.');
  expectNotice(state, { type: 'STAGE', seatId: 'u1', pickType: 'leader', key: 'X' }, rng, '⚠️ CWC draft is not currently accepting that action.');

  state = step(state, { type: 'SELECT_CAPTAIN', byUserId: 'u1', teamIndex: 0, userId: 'u2' }, rng).state as CwcDraftState;
  expectNotice(state, { type: 'SELECT_CAPTAIN', byUserId: 'u1', teamIndex: 1, userId: 'u2' }, rng, '⚠️ Team captains must be different users.');
  state = step(state, { type: 'SELECT_CAPTAIN', byUserId: 'u1', teamIndex: 0, userId: 'u3' }, rng).state as CwcDraftState;
  const started = step(state, { type: 'SELECT_CAPTAIN', byUserId: 'u1', teamIndex: 1, userId: 'u4' }, rng);
  state = started.state as CwcDraftState;
  assert.equal(state.round, 'leader');
  const firstTurn = started.events.find((event) => event.type === 'TURN_STARTED');
  assert.ok(firstTurn && firstTurn.type === 'TURN_STARTED' && firstTurn.seatId === 'u3' && firstTurn.teamIndex === 0);
  assert.ok(started.events.some((event) => event.type === 'ROUND_ADVANCED' && event.round === 'leader'));

  expectNotice(state, { type: 'PICK', seatId: 'u3', key: 'X', turnToken: 999 }, rng, '⚠️ That pick menu is stale.');
  expectNotice(state, { type: 'PICK', seatId: 'u4', key: state.leaderPool[0] as string, turnToken: state.turnToken }, rng, '⚠️ It is not your turn to pick.');
  expectNotice(state, { type: 'PICK', seatId: 'u3', key: 'NOPE', turnToken: state.turnToken }, rng, '⚠️ That leader is no longer available.');
  expectNotice(state, { type: 'SELECT_CAPTAIN', byUserId: 'u1', teamIndex: 0, userId: 'u2' }, rng, '⚠️ CWC draft is not currently accepting picks.');

  state = step(state, { type: 'PICK', seatId: 'u3', key: state.leaderPool[0] as string, turnToken: state.turnToken }, rng).state as CwcDraftState;
  state = step(state, { type: 'PICK', seatId: 'u4', key: state.leaderPool[1] as string, turnToken: state.turnToken }, rng).state as CwcDraftState;

  const auto = step(state, { type: 'TIMEOUT' }, rng);
  state = auto.state as CwcDraftState;
  assert.ok(auto.events.some((event) => event.type === 'AUTO_PICK_APPLIED' && event.teamIndex === 1 && event.round === 'leader'));

  const used = new Set([...state.teamPicks[0].leaders, ...state.teamPicks[1].leaders]);
  const lastLeader = state.leaderPool.find((key) => !used.has(key)) as string;
  state = step(state, { type: 'PICK', seatId: 'u3', key: lastLeader, turnToken: state.turnToken }, rng).state as CwcDraftState;
  assert.equal(state.round, 'civ');
  assert.deepEqual([state.teamPicks[0].leaders.length, state.teamPicks[1].leaders.length], [2, 2]);
  assert.equal(new Set([...state.teamPicks[0].leaders, ...state.teamPicks[1].leaders]).size, 4, 'leaders unique across teams');

  expectNotice(state, { type: 'PICK', seatId: 'u3', key: 'NOPE', turnToken: state.turnToken }, rng, '⚠️ That civ is no longer available.');

  const sharedCiv = state.civPool[0] as string;
  state = step(state, { type: 'PICK', seatId: 'u3', key: sharedCiv, turnToken: state.turnToken }, rng).state as CwcDraftState;
  state = step(state, { type: 'PICK', seatId: 'u4', key: sharedCiv, turnToken: state.turnToken }, rng).state as CwcDraftState;
  state = step(state, { type: 'PICK', seatId: 'u4', key: sharedCiv, turnToken: state.turnToken }, rng).state as CwcDraftState;
  const finished = step(state, { type: 'PICK', seatId: 'u3', key: sharedCiv, turnToken: state.turnToken }, rng);
  state = finished.state as CwcDraftState;
  assert.equal(state.status, 'complete');
  assert.deepEqual(state.teamPicks[0].civs, [sharedCiv, sharedCiv], 'civ duplicates allowed');
  assert.ok(finished.events.some((event) => event.type === 'DRAFT_COMPLETED' && event.reason === 'complete'));
  expectNotice(state, { type: 'PICK', seatId: 'u3', key: sharedCiv, turnToken: state.turnToken }, rng, '⚠️ CWC draft is not active.');
});

test('cwc: create validations, captain timeout fill (one and both missing), CIV6 leader-only rounds', () => {
  const rng = createSeededRandom('cwc-2');
  // D15: CWC is Teamer-only — neither FFA nor Duel may reach it
  expectCreateError(
    () => createDraftSession('cwc', { ...baseConfig, edition: 'CIV6', gameType: 'FFA', seatIds: ['a', 'b', 'c', 'd'] }, rng),
    'CWC is only available for Teamer votes.',
  );
  expectCreateError(
    () => createDraftSession('cwc', { ...baseConfig, edition: 'CIV6', gameType: 'Duel', seatIds: ['a', 'b'] }, rng),
    'CWC is only available for Teamer votes.',
  );
  expectCreateError(
    () => createDraftSession('cwc', { ...baseConfig, edition: 'CIV6', gameType: 'Teamer', numberTeams: 3, seatIds: ['a', 'b', 'c', 'd'] }, rng),
    'CWC requires exactly 2 teams.',
  );
  expectCreateError(
    () => createDraftSession('cwc', { ...baseConfig, edition: 'CIV6', gameType: 'Teamer', numberTeams: 2, seatIds: ['a', 'b', 'c'] }, rng),
    'CWC requires an even player count from 4 to 16.',
  );
  expectCreateError(
    () => createDraftSession('cwc', {
      ...baseConfig,
      edition: 'CIV6',
      gameType: 'Teamer',
      numberTeams: 2,
      seatIds: Array.from({ length: 18 }, (_, index) => `u${index}`),
    }, rng),
    'CWC requires an even player count from 4 to 16.',
  );

  const created = createDraftSession('cwc', {
    ...baseConfig,
    edition: 'CIV6',
    gameType: 'Teamer',
    numberTeams: 2,
    seatIds: ['u1', 'u2', 'u3', 'u4'],
  }, rng);

  // one captain chosen, one filled by timeout
  let state = step(created.state, { type: 'SELECT_CAPTAIN', byUserId: 'u1', teamIndex: 0, userId: 'u2' }, rng).state as CwcDraftState;
  const filled = step(state, { type: 'TIMEOUT' }, rng);
  state = filled.state as CwcDraftState;
  assert.equal(state.captainIds[0], 'u2', 'chosen captain preserved');
  assert.ok(state.captainIds[1] && state.captainIds[1] !== 'u2', 'missing captain filled with a different voter');
  assert.equal(state.round, 'leader');
  assert.ok(filled.events.some((event) => event.type === 'CAPTAIN_SET' && event.auto));

  // both captains filled by timeout
  const bothFilled = step(created.state, { type: 'TIMEOUT' }, rng);
  const bothState = bothFilled.state as CwcDraftState;
  assert.ok(bothState.captainIds[0] && bothState.captainIds[1] && bothState.captainIds[0] !== bothState.captainIds[1]);
  assert.equal(bothFilled.events.filter((event) => event.type === 'CAPTAIN_SET' && event.auto).length, 2);

  // CIV6: leader round only → complete after 4 picks (2 per team)
  let civ6 = bothState;
  for (let i = 0; i < 4; i += 1) {
    const auto = step(civ6, { type: 'TIMEOUT' }, rng);
    civ6 = auto.state as CwcDraftState;
  }
  assert.equal(civ6.status, 'complete');
  assert.deepEqual([civ6.teamPicks[0].civs.length, civ6.teamPicks[1].civs.length], [0, 0], 'no civ round for CIV6');
});

test('cwc: synthetic states — complete-round TIMEOUT no-op, missing captain turn, no-pool auto paths, create pool errors', () => {
  const rng = createSeededRandom('cwc-3');
  const created = createDraftSession('cwc', {
    ...baseConfig,
    edition: 'CIV7',
    startingAge: 'Antiquity_Age',
    gameType: 'Teamer',
    numberTeams: 2,
    seatIds: ['u1', 'u2', 'u3', 'u4'],
  }, rng);
  const started = step(created.state, { type: 'TIMEOUT' }, rng).state as CwcDraftState;

  const completeRound: CwcDraftState = structuredClone(started);
  (completeRound as { round: CwcDraftState['round'] }).round = 'complete';
  const noop = step(completeRound, { type: 'TIMEOUT' }, rng);
  assert.deepEqual(noop.events, []);
  expectNotice(completeRound, { type: 'PICK', seatId: 'u1', key: 'X', turnToken: completeRound.turnToken }, rng, '⚠️ CWC draft is not currently accepting picks.');

  // restored state with a vacant captain seat on the current turn
  const vacantCaptain: CwcDraftState = structuredClone(started);
  vacantCaptain.captainIds[vacantCaptain.pickOrder[vacantCaptain.turnIndex] as 0 | 1] = null;
  expectNotice(vacantCaptain, {
    type: 'PICK',
    seatId: 'u1',
    key: vacantCaptain.leaderPool[0] as string,
    turnToken: vacantCaptain.turnToken,
  }, rng, '⚠️ It is not your turn to pick.');

  // leader pool exhausted at TIMEOUT → no-pool completion
  const noLeaders: CwcDraftState = structuredClone(started);
  (noLeaders as { leaderPool: readonly string[] }).leaderPool = [];
  const closedLeaders = step(noLeaders, { type: 'TIMEOUT' }, rng);
  assert.equal((closedLeaders.state as CwcDraftState).status, 'complete');
  assert.ok(closedLeaders.events.some((event) => event.type === 'DRAFT_COMPLETED' && event.reason === 'no-pool'));

  // civ round with an empty civ pool at TIMEOUT → no-pool completion
  const noCivs: CwcDraftState = structuredClone(started);
  (noCivs as { round: CwcDraftState['round'] }).round = 'civ';
  noCivs.turnIndex = 0;
  (noCivs as { civPool: readonly string[] }).civPool = [];
  const closedCivs = step(noCivs, { type: 'TIMEOUT' }, rng);
  assert.equal((closedCivs.state as CwcDraftState).status, 'complete');
  assert.ok(closedCivs.events.some((event) => event.type === 'DRAFT_COMPLETED' && event.reason === 'no-pool'));

  // leader pool exhausted at create
  const allCiv6Leaders = getAvailableCiv6LeaderKeys(new Set());
  expectCreateError(
    () => createDraftSession('cwc', {
      ...baseConfig,
      edition: 'CIV6',
      gameType: 'Teamer',
      numberTeams: 2,
      seatIds: Array.from({ length: 16 }, (_, index) => `u${index}`),
      bannedLeaderKeys: allCiv6Leaders.slice(0, allCiv6Leaders.length - 10),
      bannedCivKeys: [],
    }, rng),
    'Not enough leaders remain after bans for CWC.',
  );

  // civ pool exhausted at create (CIV7)
  const allAntiquity = getAvailableCiv7CivKeys({ startingAge: 'Antiquity_Age', banned: new Set() });
  expectCreateError(
    () => createDraftSession('cwc', {
      ...baseConfig,
      edition: 'CIV7',
      startingAge: 'Antiquity_Age',
      gameType: 'Teamer',
      numberTeams: 2,
      seatIds: ['u1', 'u2', 'u3', 'u4'],
      bannedCivKeys: allAntiquity,
    }, rng),
    'No civs remain after bans for CWC.',
  );
});

test('determinism: identical seeds reproduce identical creation states', () => {
  const makeSnake = (): DraftSessionState => createDraftSession('snake', {
    ...baseConfig,
    edition: 'CIV6',
    gameType: 'FFA',
    seatIds: ['a', 'b', 'c', 'd'],
  }, createSeededRandom('det')).state;
  assert.deepEqual(makeSnake(), makeSnake());

  const makeCwc = (): DraftSessionState => createDraftSession('cwc', {
    ...baseConfig,
    edition: 'CIV7',
    startingAge: 'None',
    gameType: 'Teamer',
    numberTeams: 2,
    seatIds: ['a', 'b', 'c', 'd'],
  }, createSeededRandom('det')).state;
  assert.deepEqual(makeCwc(), makeCwc());
});

test('snake: SUBMIT re-validates a staged key that another seat took first', () => {
  const rng = createSeededRandom('snake-5');
  const created = createDraftSession('snake', {
    ...baseConfig,
    edition: 'CIV6',
    gameType: 'FFA',
    seatIds: ['u1', 'u2', 'u3'],
  }, rng);
  const base = created.state as SnakeDraftState;

  // synthetic restore: the current picker staged a leader that is already
  // committed to another seat (possible across a persisted STAGE → SUBMIT gap).
  const contested: SnakeDraftState = structuredClone(base);
  const taken = base.leaderPool[0] as string;
  const other = base.order[1] as string;
  contested.picks[other] = { leaderKey: taken };
  contested.staged[base.order[0] as string] = { leaderKey: taken };

  expectNotice(
    contested,
    { type: 'SUBMIT', seatId: base.order[0] as string, turnToken: contested.turnToken },
    rng,
    '⚠️ That choice is no longer available.',
  );
});

test('cwc: civ-round TIMEOUT auto-picks a civ for the current team', () => {
  const rng = createSeededRandom('cwc-4');
  const created = createDraftSession('cwc', {
    ...baseConfig,
    edition: 'CIV7',
    startingAge: 'Antiquity_Age',
    gameType: 'Teamer',
    numberTeams: 2,
    seatIds: ['u1', 'u2', 'u3', 'u4'],
  }, rng);

  // captains auto-filled, then every leader pick auto-applied → civ round
  let state = step(created.state, { type: 'TIMEOUT' }, rng).state as CwcDraftState;
  for (let i = 0; i < 4; i += 1) {
    state = step(state, { type: 'TIMEOUT' }, rng).state as CwcDraftState;
  }
  assert.equal(state.round, 'civ');

  const civTimeout = step(state, { type: 'TIMEOUT' }, rng);
  const civState = civTimeout.state as CwcDraftState;
  const autoCiv = civTimeout.events.find((event) => event.type === 'AUTO_PICK_APPLIED');
  assert.ok(autoCiv && autoCiv.type === 'AUTO_PICK_APPLIED' && autoCiv.round === 'civ');
  assert.equal(
    civState.teamPicks[0].civs.length + civState.teamPicks[1].civs.length,
    1,
    'exactly one civ auto-picked',
  );
  assert.ok(civState.civPool.includes(autoCiv.key), 'auto-pick comes from the civ pool');

  // and the remaining civ picks complete the draft
  for (let i = 0; i < 3; i += 1) {
    state = step(civState, { type: 'TIMEOUT' }, rng).state as CwcDraftState;
  }
});
