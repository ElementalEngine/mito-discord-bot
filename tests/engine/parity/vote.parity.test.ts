import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as legacyBans from '../../../src/services/voting/domain/bans.service.js';
import * as legacyTally from '../../../src/services/voting/domain/tally.service.js';
import * as legacyTiebreak from '../../../src/services/voting/domain/tiebreak.service.js';

import * as engBans from '../../../src/engine/vote/bans.js';
import * as engPlurality from '../../../src/engine/vote/plurality.js';
import * as engTally from '../../../src/engine/vote/tally.js';

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

test('tally: maxSelections / multi-select detection parity', () => {
  for (const question of [Q_SINGLE, Q_MULTI]) {
    assert.equal(engTally.getQuestionMaxSelections(question), legacyTally.getQuestionMaxSelections(question));
    assert.equal(engTally.isMultiSelectQuestion(question), legacyTally.isMultiSelectQuestion(question));
  }
});

test('tally: decode / encode / count parity across edge inputs', () => {
  const storedValues: (string | undefined)[] = [undefined, '', 'a', 'b|c', 'c|b|a', 'x|a', ' a | b ', 'a|a|b'];
  const selections: string[][] = [[], ['a'], ['c', 'a'], ['x'], ['b', 'b', 'c', 'a']];
  for (const question of [Q_SINGLE, Q_MULTI]) {
    for (const stored of storedValues) {
      assert.deepEqual(
        engTally.decodeVoteSelections(question, stored),
        legacyTally.decodeVoteSelections(question, stored),
        `${question.id} decode(${String(stored)})`,
      );
    }
    for (const selection of selections) {
      assert.equal(
        engTally.encodeVoteSelections(question, selection),
        legacyTally.encodeVoteSelections(question, selection),
        `${question.id} encode(${selection.join(',')})`,
      );
    }
    const record = new Map([
      ['u1', 'a'],
      ['u2', 'b|c'],
      ['u3', 'c'],
    ]);
    assert.deepEqual(
      [...engTally.voteCountByOption(question, record).entries()],
      [...legacyTally.voteCountByOption(question, record).entries()],
    );
  }
});

test('plurality: winner + deterministic tiebreak parity vs legacy selectWinner', () => {
  const voterIds = ['u1', 'u2', 'u3', 'u4'];
  const cases: [string, Map<string, string>][] = [
    ['no-tie', new Map([['u1', 'a'], ['u2', 'a'], ['u3', 'b'], ['u4', 'c']])],
    ['tie-2', new Map([['u1', 'a'], ['u2', 'a'], ['u3', 'b'], ['u4', 'b']])],
    ['tie-4', new Map([['u1', 'a'], ['u2', 'b'], ['u3', 'c'], ['u4', 'a|b']])],
    ['incomplete', new Map([['u1', 'a']])],
    ['empty-values', new Map([['u1', ''], ['u2', ''], ['u3', ''], ['u4', '']])],
  ];
  for (const [label, record] of cases) {
    for (const sessionId of ['sess-1', 'sess-2', 'zzz']) {
      const tiebroken = new Set<string>();
      const legacyWinner = legacyTiebreak.selectWinner(sessionId, Q_SINGLE, record, voterIds, tiebroken);
      const engineWinner = engPlurality.resolveQuestionWinner(sessionId, Q_SINGLE, record, voterIds);
      assert.equal(engineWinner.winnerId, legacyWinner, `${label} ${sessionId}`);
      assert.equal(Boolean(engineWinner.tiebreak), tiebroken.has(Q_SINGLE.id), `${label} ${sessionId} tiebreak flag`);
      if (engineWinner.tiebreak) {
        assert.equal(engineWinner.tiebreak.questionId, Q_SINGLE.id);
        assert.ok(engineWinner.tiebreak.tied.includes(engineWinner.winnerId));
      }
    }
  }
});

test('plurality: lockAllQuestions parity vs legacy ensureLockedAll + getDraftMode', () => {
  const voterIds = ['u1', 'u2', 'u3', 'u4'];
  const draftModeQuestion: VoteQuestion = {
    id: 'draft_mode',
    title: 'Mode',
    options: [
      { id: 'standard', label: 'S' },
      { id: 'blind', label: 'B' },
    ],
    defaultOptionId: 'standard',
  } as VoteQuestion;
  const questions = [Q_SINGLE, Q_MULTI, draftModeQuestion];
  const votesByQuestion = new Map<string, Map<string, string>>([
    ['q1', new Map([['u1', 'a'], ['u2', 'b'], ['u3', 'b'], ['u4', 'c']])],
    ['draft_mode', new Map([['u1', 'blind'], ['u2', 'blind'], ['u3', 'standard'], ['u4', 'standard']])],
  ]);

  const legacySession = {
    sessionId: 'sess-lock',
    voterIds,
    questions,
    votesByQuestion: new Map([...votesByQuestion.entries()].map(([key, value]) => [key, new Map(value)])),
    lockedSettings: new Map<string, string>(),
    tiebrokenQuestions: new Set<string>(),
  };
  legacyTiebreak.ensureLockedAll(legacySession as never);

  const engineLocked = engPlurality.lockAllQuestions({
    sessionId: 'sess-lock',
    questions,
    votesByQuestion,
    voterIds,
  });

  assert.deepEqual([...engineLocked.locked.entries()], [...legacySession.lockedSettings.entries()]);
  assert.deepEqual(new Set(engineLocked.tiebreaks.map((t) => t.questionId)), legacySession.tiebrokenQuestions);
  assert.equal(
    engPlurality.getDraftModeFromLocked(questions, engineLocked.locked),
    legacyTiebreak.getDraftMode(legacySession as never),
  );
});

test('bans: majorityBans + threshold + submitted summary parity', () => {
  const voterIds = ['u1', 'u2', 'u3', 'u4', 'u5'];
  const perVoter = new Map<string, ReadonlySet<string>>([
    ['u1', new Set(['L1', 'L2'])],
    ['u2', new Set(['L1'])],
    ['u3', new Set(['L1', 'L3'])],
    ['u5', new Set(['L3', 'L2'])],
  ]);
  assert.deepEqual(engBans.majorityBans(voterIds, perVoter), legacyBans.majorityBans(voterIds, perVoter));
  for (let n = 0; n <= 17; n += 1) {
    assert.equal(engBans.majorityThreshold(n), Math.floor(n / 2) + 1);
  }

  const bansByVoter = new Map([
    ['u1', { leaderKeys: ['L1'], civKeys: ['C1'] }],
    ['u2', { leaderKeys: ['L2'], civKeys: [] as string[] }],
    ['u3', { leaderKeys: ['L1', 'L2'], civKeys: ['C1', 'C2'] }],
  ]);
  const submitted = new Set(['u1', 'u3']);

  const legacySummary7 = legacyBans.getSubmittedBanSummary({
    edition: 'CIV7',
    voterIds,
    bansSubmitted: submitted,
    bansByVoter,
  } as never);
  const engineSummary7 = engBans.summarizeSubmittedBans({
    edition: 'CIV7',
    voterIds,
    submittedVoterIds: submitted,
    bansByVoter,
  });
  assert.deepEqual([...engineSummary7.leader.entries()], [...legacySummary7.leader.entries()]);
  assert.deepEqual([...engineSummary7.civ.entries()], [...legacySummary7.civ.entries()]);

  const legacySummary6 = legacyBans.getSubmittedBanSummary({
    edition: 'CIV6',
    voterIds,
    bansSubmitted: submitted,
    bansByVoter,
  } as never);
  const engineSummary6 = engBans.summarizeSubmittedBans({
    edition: 'CIV6',
    voterIds,
    submittedVoterIds: submitted,
    bansByVoter,
  });
  assert.deepEqual([...engineSummary6.leader.entries()], [...legacySummary6.leader.entries()]);
  assert.deepEqual([...engineSummary6.civ.entries()], [...legacySummary6.civ.entries()]);
});
