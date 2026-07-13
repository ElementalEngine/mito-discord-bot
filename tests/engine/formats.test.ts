import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CIV6_LEADERS } from '../../src/data/civ6.data.js';
import { CIV7_CIVS, CIV7_LEADERS } from '../../src/data/civ7.data.js';
import type { Civ7CivKey } from '../../src/data/types.js';

import {
  DRAFT_FORMATS,
  keysToColonTokens,
  resolveRandomDraft,
} from '../../src/engine/drafts/formats.js';
import { getAvailableCiv7CivKeys } from '../../src/engine/drafts/pools.js';
import { createSeededRandom } from '../../src/engine/random.js';
import type { DraftSessionConfig } from '../../src/engine/types.js';

const baseConfig: Omit<DraftSessionConfig, 'edition' | 'gameType' | 'seatIds'> = {
  sessionId: 's1',
  voteUuid: 'v1',
  hostId: 'u1',
  bannedLeaderKeys: [],
  bannedCivKeys: [],
};

test('keysToColonTokens: frozen legacy semantics (gameId tokens, unknown keys dropped, empty → undefined)', () => {
  const keys = Object.keys(CIV6_LEADERS).slice(0, 2);
  const expected = keys.map((key) => `:${CIV6_LEADERS[key as keyof typeof CIV6_LEADERS].gameId}:`).join('\n');
  assert.equal(keysToColonTokens(keys, CIV6_LEADERS), expected);
  assert.equal(keysToColonTokens([], CIV6_LEADERS), undefined);
  assert.equal(keysToColonTokens(['NOT_A_KEY'], CIV6_LEADERS), undefined);
  assert.equal(keysToColonTokens(['NOT_A_KEY', keys[0] as string], CIV6_LEADERS), `:${CIV6_LEADERS[keys[0] as keyof typeof CIV6_LEADERS].gameId}:`);
});

test('resolveRandomDraft: CIV6 unique assignments from a large pool; deterministic under seed', () => {
  const seatIds = ['u1', 'u2', 'u3', 'u4'];
  const config: DraftSessionConfig = { ...baseConfig, edition: 'CIV6', gameType: 'FFA', seatIds };
  const first = resolveRandomDraft(config, createSeededRandom('rand-1'));
  const second = resolveRandomDraft(config, createSeededRandom('rand-1'));
  assert.deepEqual(first, second);
  assert.equal(first.assignments.length, 4);
  assert.deepEqual(first.assignments.map((assignment) => assignment.seatId), seatIds);
  const leaders = first.assignments.map((assignment) => assignment.leaderKey);
  assert.equal(new Set(leaders).size, leaders.length, 'pool >= seats → shuffled slice, unique');
  for (const assignment of first.assignments) {
    assert.ok(assignment.leaderKey in CIV6_LEADERS);
    assert.equal(assignment.civKey, undefined);
  }
});

test('resolveRandomDraft: CIV7 leader+civ assignments; with-replacement when the pool is smaller than seats', () => {
  const seatIds = ['u1', 'u2', 'u3', 'u4', 'u5'];
  const keepLeaders = Object.keys(CIV7_LEADERS).slice(0, 2);
  const bannedLeaderKeys = Object.keys(CIV7_LEADERS).filter((key) => !keepLeaders.includes(key));
  const config: DraftSessionConfig = {
    ...baseConfig,
    edition: 'CIV7',
    startingAge: 'Antiquity_Age',
    gameType: 'FFA',
    seatIds,
    bannedLeaderKeys,
  };
  const result = resolveRandomDraft(config, createSeededRandom('rand-2'));
  assert.equal(result.assignments.length, 5);
  for (const assignment of result.assignments) {
    assert.ok(keepLeaders.includes(assignment.leaderKey), 'with-replacement draws stay within the reduced pool');
    assert.ok(typeof assignment.civKey === 'string' && assignment.civKey in CIV7_CIVS);
  }
});

test('resolveRandomDraft: NO_POOL errors for exhausted leader and civ pools', () => {
  const allLeaders = Object.keys(CIV7_LEADERS);
  assert.throws(
    () => resolveRandomDraft({
      ...baseConfig,
      edition: 'CIV7',
      startingAge: 'Antiquity_Age',
      gameType: 'FFA',
      seatIds: ['u1', 'u2'],
      bannedLeaderKeys: allLeaders,
    }, createSeededRandom('x')),
    { message: 'No leaders remain after bans.' },
  );

  const allAntiquity = getAvailableCiv7CivKeys({ startingAge: 'Antiquity_Age', banned: new Set<Civ7CivKey>() });
  assert.throws(
    () => resolveRandomDraft({
      ...baseConfig,
      edition: 'CIV7',
      startingAge: 'Antiquity_Age',
      gameType: 'FFA',
      seatIds: ['u1', 'u2'],
      bannedCivKeys: allAntiquity,
    }, createSeededRandom('x')),
    { message: 'No civs remain after bans.' },
  );
});

test('DRAFT_FORMATS: all five modes present with the D5 instant/interactive split', () => {
  assert.deepEqual(DRAFT_FORMATS.map((format) => format.id), ['standard', 'random', 'blind', 'snake', 'cwc']);
  assert.deepEqual(
    DRAFT_FORMATS.map((format) => format.kind),
    ['instant', 'instant', 'interactive', 'interactive', 'interactive'],
  );
});

test('resolveRandomDraft: an empty seat list yields no assignments', () => {
  const result = resolveRandomDraft(
    { ...baseConfig, edition: 'CIV6', gameType: 'FFA', seatIds: [] },
    createSeededRandom('empty'),
  );
  assert.deepEqual(result.assignments, []);
});
