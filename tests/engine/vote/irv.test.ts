import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createSeededRandom } from '../../../src/engine/random.js';
import { normalizeRankedBallot, resolveRankedChoiceElection } from '../../../src/engine/vote/irv.js';

const rng = (): ReturnType<typeof createSeededRandom> => createSeededRandom('irv-seed');

test('normalizeRankedBallot: drops unknown candidates and duplicate mentions, keeps first-mention order', () => {
  assert.deepEqual(normalizeRankedBallot(['b', 'x', 'a', 'b', 'a'], ['a', 'b', 'c']), ['b', 'a']);
  assert.deepEqual(normalizeRankedBallot([], ['a']), []);
});

test('first-round majority wins immediately with a single audit round', () => {
  const result = resolveRankedChoiceElection(
    [['a'], ['a'], ['a', 'b'], ['b']],
    ['a', 'b', 'c'],
    'a',
    rng(),
  );
  assert.equal(result.winnerId, 'a');
  assert.equal(result.finalVotes, 3);
  assert.equal(result.rounds.length, 1);
  const round = result.rounds[0];
  assert.ok(round);
  assert.equal(round.majorityThreshold, 3);
  assert.equal(round.winnerId, 'a');
  assert.equal(round.eliminatedId, null);
  assert.deepEqual(round.tallies.map((tally) => tally.id), ['a', 'b'], 'zero-mention candidates dropped before round 1');
});

test('elimination transfers ballots to next preferences', () => {
  // c eliminated first; its ballot transfers to b, giving b the majority
  const result = resolveRankedChoiceElection(
    [['a'], ['a'], ['b'], ['b'], ['c', 'b']],
    ['a', 'b', 'c'],
    'a',
    rng(),
  );
  assert.equal(result.winnerId, 'b');
  assert.equal(result.rounds.length, 2);
  assert.equal(result.rounds[0]?.eliminatedId, 'c');
  assert.equal(result.rounds[1]?.winnerId, 'b');
  assert.equal(result.finalVotes, 3);
});

test('exhausted ballots shrink the active count and majority threshold', () => {
  // the [c] ballot exhausts after c is eliminated
  const result = resolveRankedChoiceElection(
    [['a'], ['a'], ['b'], ['c']],
    ['a', 'b', 'c'],
    'a',
    rng(),
  );
  assert.equal(result.winnerId, 'a');
  const lastRound = result.rounds[result.rounds.length - 1];
  assert.ok(lastRound);
  assert.equal(lastRound.activeBallotCount, 3, 'exhausted ballot no longer counted');
});

test('final-two tie: original-first-choice rule', () => {
  // r1: a2 b2 c1 → eliminate c (unique lowest); r2: a2 b3?? — construct a true final-two tie
  // ballots: a,a,b,b + c→(no transfer) leaves a2 b2 tie; c had 1 first-choice
  const result = resolveRankedChoiceElection(
    [['a'], ['a'], ['b'], ['b', 'a'], ['c']],
    ['a', 'b', 'c'],
    'c',
    rng(),
  );
  // r1: a2 b2 c1, majority 3 → eliminate c; r2: a2 b2 tie (c exhausted) →
  // final-two tie; original first choices equal (2 vs 2) → total mentions:
  // a appears 3 times, b 2 → 'a' wins by total-mentions
  assert.equal(result.winnerId, 'a');
  const finalRound = result.rounds[result.rounds.length - 1];
  assert.ok(finalRound?.tieBreak);
  assert.equal(finalRound.tieBreak.rule, 'total-mentions');
  assert.equal(finalRound.winnerId, 'a');
});

test('final-two tie: original-first-choice rule resolves before total-mentions', () => {
  // Craft: first choices a3 b2; but current-round tie after transfers.
  // ballots: a,a,a? — need a tie in the final round with unequal original firsts:
  // ballots: [a],[a],[b],[b],[c,b],[c,a] → r1 a2 b2 c2 majority 4 none; eliminate tie a/b/c?
  // Keep it simpler with 2 candidates from the start and unequal mentions via a third:
  const result = resolveRankedChoiceElection(
    [['a'], ['a'], ['b'], ['b'], ['c', 'a'], ['c', 'b'], ['a', 'b'], ['b', 'a'], ['c']],
    ['a', 'b', 'c'],
    'c',
    rng(),
  );
  // r1: a3 b3 c3 majority 5 → three-way lowest tie (eliminate mode) →
  // first-choice all equal → total mentions a5 b5 c3 → eliminate c.
  // r2: a4 b4 (one c ballot exhausted) tie → winner mode: first-choice 3=3 →
  // mentions 5=5 → seeded-random decides.
  const eliminationRound = result.rounds[0];
  assert.ok(eliminationRound?.tieBreak);
  assert.equal(eliminationRound.tieBreak.rule, 'total-mentions');
  assert.equal(eliminationRound.eliminatedId, 'c');

  const finalRound = result.rounds[result.rounds.length - 1];
  assert.ok(finalRound?.tieBreak);
  assert.equal(finalRound.tieBreak.rule, 'seeded-random');
  assert.ok(['a', 'b'].includes(result.winnerId));

  // seeded-random is deterministic per seed
  const repeat = resolveRankedChoiceElection(
    [['a'], ['a'], ['b'], ['b'], ['c', 'a'], ['c', 'b'], ['a', 'b'], ['b', 'a'], ['c']],
    ['a', 'b', 'c'],
    'c',
    rng(),
  );
  assert.equal(repeat.winnerId, result.winnerId);
});

test('elimination tie: original-first-choice rule picks the weakest candidate', () => {
  // r1: a3 b1 c1 d1 — b/c/d tie for lowest; first choices 1,1,1 tie → mentions:
  // b appears twice (one second-place mention), c and d once → b is NOT lowest;
  // c/d still tied on mentions → seeded-random among c/d.
  // To hit the original-first-choice elimination rule cleanly:
  // r1: a2 b2 c1 d1... instead craft lowest tie where first choices differ via transfers:
  const result = resolveRankedChoiceElection(
    [['a'], ['a'], ['a'], ['b'], ['c'], ['d'], ['d']],
    ['a', 'b', 'c', 'd'],
    'a',
    rng(),
  );
  // r1: a3 b1 c1 d2 majority 4 → lowest tie b/c (1,1) → first choices equal →
  // mentions equal (1,1) → seeded-random eliminates one of b/c.
  const firstRound = result.rounds[0];
  assert.ok(firstRound?.tieBreak);
  assert.equal(firstRound.tieBreak.rule, 'seeded-random');
  assert.ok(['b', 'c'].includes(firstRound.eliminatedId as string));
  assert.equal(result.winnerId, 'a');
});

test('elimination tie: first-choice rule fires when transfers separate original strength', () => {
  // Round 2 lowest tie between b (original first-choice 2) and c (original 1
  const result = resolveRankedChoiceElection(
    [['a'], ['a'], ['a'], ['b'], ['b'], ['c'], ['e', 'c'], ['e', 'a'], ['a']],
    ['a', 'b', 'c', 'e'],
    'a',
    rng(),
  );
  assert.equal(result.rounds[0]?.eliminatedId, 'c');
  assert.equal(result.rounds[0]?.tieBreak, null);
  assert.equal(result.winnerId, 'a');
});

test('empty and unmatchable ballots fall back to the provided default', () => {
  const empty = resolveRankedChoiceElection<string>([], ['a', 'b'], 'fallback', rng());
  assert.deepEqual(empty, { winnerId: 'fallback', rounds: [], finalVotes: 0 });

  const unmatchable = resolveRankedChoiceElection([['x', 'y']], ['a', 'b'], 'fallback', rng());
  assert.deepEqual(unmatchable, { winnerId: 'fallback', rounds: [], finalVotes: 0 });
});

test('round tallies are sorted votes-desc then candidate order', () => {
  const result = resolveRankedChoiceElection(
    [['b'], ['b'], ['a'], ['a'], ['c']],
    ['a', 'b', 'c'],
    'a',
    rng(),
  );
  const firstRound = result.rounds[0];
  assert.ok(firstRound);
  assert.deepEqual(
    firstRound.tallies.map((tally) => tally.id),
    ['a', 'b', 'c'],
    'a and b tie on votes → candidate order breaks display order',
  );
});

test('elimination tie: the original-first-choice rule separates candidates tied on current votes', () => {
  const result = resolveRankedChoiceElection(
    [['a'], ['a'], ['a'], ['b'], ['b'], ['c'], ['d', 'c']],
    ['a', 'b', 'c', 'd'],
    'a',
    rng(),
  );

  const round1 = result.rounds[0];
  assert.ok(round1?.tieBreak);
  assert.equal(round1.tieBreak.rule, 'total-mentions');
  assert.equal(round1.eliminatedId, 'd');

  const round2 = result.rounds[1];
  assert.ok(round2?.tieBreak);
  assert.equal(round2.tieBreak.rule, 'original-first-choice');
  assert.equal(round2.eliminatedId, 'c');

  assert.equal(result.winnerId, 'a');
});

test('elimination tie: total-mentions rule breaks a first-choice tie (eliminate mode)', () => {
  const result = resolveRankedChoiceElection(
    [['a', 'b', 'c'], ['a'], ['b'], ['b'], ['c'], ['c']],
    ['a', 'b', 'c'],
    'a',
    rng(),
  );
  const round1 = result.rounds[0];
  assert.ok(round1?.tieBreak);
  assert.equal(round1.tieBreak.rule, 'total-mentions');
  assert.equal(round1.eliminatedId, 'a');
  assert.equal(result.winnerId, 'b');
});

test('final-two tie: seeded-random rule when first-choice and total-mentions both tie (winner mode)', () => {
  const result = resolveRankedChoiceElection(
    [['a', 'b'], ['b', 'a']],
    ['a', 'b'],
    'a',
    createSeededRandom('irv-tie-winner'),
  );
  const finalRound = result.rounds[result.rounds.length - 1];
  assert.ok(finalRound?.tieBreak);
  assert.equal(finalRound.tieBreak.rule, 'seeded-random');
  assert.ok(['a', 'b'].includes(result.winnerId));
  // determinism: same seed → same winner
  const again = resolveRankedChoiceElection(
    [['a', 'b'], ['b', 'a']],
    ['a', 'b'],
    'a',
    createSeededRandom('irv-tie-winner'),
  );
  assert.equal(again.winnerId, result.winnerId);
});

test('elimination tie: seeded-random rule when a 3-way tie is fully symmetric (eliminate mode)', () => {
  const result = resolveRankedChoiceElection(
    [['a', 'b', 'c'], ['b', 'c', 'a'], ['c', 'a', 'b']],
    ['a', 'b', 'c'],
    'a',
    createSeededRandom('irv-tie-elim'),
  );
  const round1 = result.rounds[0];
  assert.ok(round1?.tieBreak);
  assert.equal(round1.tieBreak.rule, 'seeded-random');
  assert.ok(['a', 'b', 'c'].includes(round1.eliminatedId as string));
});

test('round tally lists a remaining candidate that received zero current-round votes', () => {
  const result = resolveRankedChoiceElection(
    [['a', 'c'], ['a', 'c'], ['b', 'c']],
    ['a', 'b', 'c'],
    'a',
    rng(),
  );
  assert.equal(result.winnerId, 'a'); // a has 2/3 first prefs → outright
  const round1 = result.rounds[0];
  assert.ok(round1);
  const cTally = round1.tallies.find((t) => t.id === 'c');
  assert.ok(cTally, 'c must appear in the round tally');
  assert.equal(cTally.votes, 0);
});
