import assert from 'node:assert/strict';
import { test } from 'node:test';

import { majorityBans, summarizeSubmittedBans } from '../../../src/engine/vote/bans.js';
import { getDraftModeFromLocked, lockAllQuestions, resolveQuestionWinner } from '../../../src/engine/vote/plurality.js';
import { decodeVoteSelections, pickRandomVoteValue } from '../../../src/engine/vote/tally.js';
import { createSeededRandom } from '../../../src/engine/random.js';
import type { VoteQuestion } from '../../../src/shared/vote.types.js';

const Q_SINGLE: VoteQuestion = {
  id: 'q1',
  title: 'T',
  options: [
    { id: 'a', label: 'A' },
    { id: 'b', label: 'B' },
    { id: 'c', label: 'C' },
  ],
  defaultOptionId: 'a',
} as VoteQuestion;

const Q_MULTI: VoteQuestion = { ...Q_SINGLE, id: 'q2', maxSelections: 2 } as VoteQuestion;

test('pickRandomVoteValue: single-select yields an option id; multi-select yields a decodable encoding', () => {
  const rng = createSeededRandom('rv');
  for (let i = 0; i < 20; i += 1) {
    const single = pickRandomVoteValue(Q_SINGLE, rng);
    assert.ok(Q_SINGLE.options.some((option) => option.id === single));

    const multi = pickRandomVoteValue(Q_MULTI, rng);
    const decoded = decodeVoteSelections(Q_MULTI, multi);
    assert.ok(decoded.length >= 1 && decoded.length <= 2);
  }
  // determinism
  assert.equal(
    pickRandomVoteValue(Q_MULTI, createSeededRandom('fixed')),
    pickRandomVoteValue(Q_MULTI, createSeededRandom('fixed')),
  );
});

test('resolveQuestionWinner: default on empty tallies even with full participation', () => {
  const voterIds = ['u1', 'u2'];
  const record = new Map([
    ['u1', ''],
    ['u2', ''],
  ]);
  const winner = resolveQuestionWinner('sess', Q_SINGLE, record, voterIds);
  assert.equal(winner.winnerId, Q_SINGLE.defaultOptionId);
  assert.equal(winner.tiebreak, null);
});

test('lockAllQuestions: questions without a record lock to their defaults', () => {
  const locked = lockAllQuestions({
    sessionId: 'sess',
    questions: [Q_SINGLE, Q_MULTI],
    votesByQuestion: new Map([['q1', new Map([['u1', 'b'], ['u2', 'b']])]]),
    voterIds: ['u1', 'u2'],
  });
  assert.equal(locked.locked.get('q1'), 'b');
  assert.equal(locked.locked.get('q2'), Q_MULTI.defaultOptionId);
  assert.deepEqual(locked.tiebreaks, []);
});

test('getDraftModeFromLocked: missing question, missing lock, and unknown option fall back correctly', () => {
  const draftModeQuestion: VoteQuestion = {
    id: 'draft_mode',
    title: 'Mode',
    options: [
      { id: 'standard', label: 'S' },
      { id: 'snake', label: 'Sn' },
    ],
    defaultOptionId: 'standard',
  } as VoteQuestion;

  assert.equal(getDraftModeFromLocked([Q_SINGLE], new Map()), 'standard');
  assert.equal(getDraftModeFromLocked([draftModeQuestion], new Map()), 'standard');
  assert.equal(getDraftModeFromLocked([draftModeQuestion], new Map([['draft_mode', 'snake']])), 'snake');
  assert.equal(getDraftModeFromLocked([draftModeQuestion], new Map([['draft_mode', 'not_an_option']])), 'standard');
});

test('majorityBans: strict majority over all voters (non-submitters count in the denominator)', () => {
  const voterIds = ['u1', 'u2', 'u3', 'u4'];
  // threshold = 3; L1 has 2 bans → NOT banned even though only 2 voters submitted
  const perVoter = new Map<string, ReadonlySet<string>>([
    ['u1', new Set(['L1'])],
    ['u2', new Set(['L1'])],
  ]);
  assert.deepEqual(majorityBans(voterIds, perVoter), []);
  const perVoterMajority = new Map<string, ReadonlySet<string>>([
    ['u1', new Set(['L1'])],
    ['u2', new Set(['L1'])],
    ['u3', new Set(['L1', 'L2'])],
  ]);
  assert.deepEqual(majorityBans(voterIds, perVoterMajority), ['L1']);
});

test('summarizeSubmittedBans: skips non-submitters and voters without recorded bans', () => {
  const summary = summarizeSubmittedBans({
    edition: 'CIV7',
    voterIds: ['u1', 'u2', 'u3'],
    submittedVoterIds: new Set(['u1', 'u3']),
    bansByVoter: new Map([
      ['u1', { leaderKeys: ['L1'], civKeys: ['C1'] }],
      // u3 submitted but has no recorded bans entry
    ]),
  });
  assert.deepEqual([...summary.leader.entries()], [['L1', 1]]);
  assert.deepEqual([...summary.civ.entries()], [['C1', 1]]);
});
