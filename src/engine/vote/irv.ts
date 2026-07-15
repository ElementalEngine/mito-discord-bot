import type { RandomSource } from '../random.js';
import { randomIndex } from '../random.js';

export type RankedChoiceTieBreakRule = 'original-first-choice' | 'total-mentions' | 'seeded-random';

export type RankedChoiceTieBreak<T extends string> = Readonly<{
  rule: RankedChoiceTieBreakRule;
  candidates: readonly T[];
  chosenId: T;
}>;

export type RankedChoiceRoundTally<T extends string> = Readonly<{
  id: T;
  votes: number;
}>;

export type RankedChoiceRound<T extends string> = Readonly<{
  round: number;
  tallies: readonly RankedChoiceRoundTally<T>[];
  activeBallotCount: number;
  majorityThreshold: number;
  eliminatedId: T | null;
  winnerId: T | null;
  tieBreak: RankedChoiceTieBreak<T> | null;
}>;

export type RankedChoiceResolution<T extends string> = Readonly<{
  winnerId: T;
  rounds: readonly RankedChoiceRound<T>[];
  finalVotes: number;
}>;

/** Drop unknown candidates and duplicate mentions, keeping first-mention order. */
export function normalizeRankedBallot<T extends string>(
  ballot: readonly T[],
  candidateIds: readonly T[]
): T[] {
  const allowed = new Set(candidateIds);
  return ballot.filter((candidateId, index) => allowed.has(candidateId) && ballot.indexOf(candidateId) === index);
}

function tallyRound<T extends string>(
  ballots: readonly (readonly T[])[],
  remainingCandidateIds: readonly T[]
): Map<T, number> {
  const remaining = new Set(remainingCandidateIds);
  const tallies = new Map<T, number>();

  for (const ballot of ballots) {
    const currentChoice = ballot.find((candidateId) => remaining.has(candidateId));
    if (currentChoice == null) continue;
    tallies.set(currentChoice, (tallies.get(currentChoice) ?? 0) + 1);
  }

  return tallies;
}

function chooseCandidates<T extends string>(
  candidateIds: readonly T[],
  metric: (candidateId: T) => number,
  mode: 'eliminate' | 'winner'
): T[] {
  // callers only pass non-empty tie sets; reduce over [] would yield [] anyway
  const targetMetric = candidateIds.reduce((current, candidateId) => {
    const nextMetric = metric(candidateId);
    if (current == null) return nextMetric;
    return mode === 'eliminate' ? Math.min(current, nextMetric) : Math.max(current, nextMetric);
  }, null as number | null);
  return candidateIds.filter((candidateId) => metric(candidateId) === targetMetric);
}

function pickRandomId<T extends string>(pool: readonly T[], rng: RandomSource): T {
  return pool[randomIndex(rng, pool.length)] as T;
}

function breakTie<T extends string>(
  candidateIds: readonly T[],
  mode: 'eliminate' | 'winner',
  originalFirstChoiceVotes: ReadonlyMap<T, number>,
  totalMentions: ReadonlyMap<T, number>,
  rng: RandomSource
): { chosenId: T; tieBreak: RankedChoiceTieBreak<T> } {
  const firstChoiceSorted = chooseCandidates(candidateIds, (candidateId) => originalFirstChoiceVotes.get(candidateId)!, mode);
  if (firstChoiceSorted.length === 1) {
    return {
      chosenId: firstChoiceSorted[0] as T,
      tieBreak: { rule: 'original-first-choice', candidates: [...candidateIds], chosenId: firstChoiceSorted[0] as T },
    };
  }

  const totalMentionSorted = chooseCandidates(firstChoiceSorted, (candidateId) => totalMentions.get(candidateId)!, mode);
  if (totalMentionSorted.length === 1) {
    return {
      chosenId: totalMentionSorted[0] as T,
      tieBreak: { rule: 'total-mentions', candidates: [...candidateIds], chosenId: totalMentionSorted[0] as T },
    };
  }

  const chosenId = pickRandomId(totalMentionSorted, rng);
  return {
    chosenId,
    tieBreak: { rule: 'seeded-random', candidates: [...candidateIds], chosenId },
  };
}

export function resolveRankedChoiceElection<T extends string>(
  ballots: readonly (readonly T[])[],
  candidateIds: readonly T[],
  fallback: T,
  rng: RandomSource
): RankedChoiceResolution<T> {
  const normalizedBallots = ballots
    .map((ballot) => normalizeRankedBallot(ballot, candidateIds))
    .filter((ballot) => ballot.length > 0);

  if (normalizedBallots.length === 0) return { winnerId: fallback, rounds: [], finalVotes: 0 };

  const candidateOrder = new Map(candidateIds.map((id, index) => [id, index]));
  const originalFirstChoiceVotes = new Map(candidateIds.map((id) => [id, 0]));
  const totalMentions = new Map(candidateIds.map((id) => [id, 0]));

  for (const ballot of normalizedBallots) {
    const firstChoice = ballot[0];
    if (firstChoice != null) originalFirstChoiceVotes.set(firstChoice, originalFirstChoiceVotes.get(firstChoice)! + 1);
    for (const candidateId of ballot) totalMentions.set(candidateId, totalMentions.get(candidateId)! + 1);
  }

  const remainingCandidateIds = candidateIds.filter((candidateId) => totalMentions.get(candidateId)! > 0);

  const rounds: RankedChoiceRound<T>[] = [];

  while (remainingCandidateIds.length > 0) {
    const tallies = tallyRound(normalizedBallots, remainingCandidateIds);
    const roundTallies = remainingCandidateIds
      .map((id) => ({ id, votes: tallies.get(id) ?? 0 }))
      .sort((left, right) => {
        if (right.votes !== left.votes) return right.votes - left.votes;
        return candidateOrder.get(left.id)! - candidateOrder.get(right.id)!;
      });
    const activeBallotCount = roundTallies.reduce((count, tally) => count + tally.votes, 0);
    const majorityThreshold = Math.floor(activeBallotCount / 2) + 1;
    const outrightWinner = roundTallies.find((tally) => tally.votes >= majorityThreshold);

    if (outrightWinner != null) {
      rounds.push({
        round: rounds.length + 1,
        tallies: roundTallies,
        activeBallotCount,
        majorityThreshold,
        eliminatedId: null,
        winnerId: outrightWinner.id,
        tieBreak: null,
      });
      return { winnerId: outrightWinner.id, rounds, finalVotes: outrightWinner.votes };
    }

    if (remainingCandidateIds.length === 2 && roundTallies[0]?.votes === roundTallies[1]?.votes) {
      const leftTally = roundTallies[0] as RankedChoiceRoundTally<T>;
      const rightTally = roundTallies[1] as RankedChoiceRoundTally<T>;
      const tie = breakTie(
        [leftTally.id, rightTally.id],
        'winner',
        originalFirstChoiceVotes,
        totalMentions,
        rng
      );
      const winnerVotes = tallies.get(tie.chosenId)!;
      rounds.push({
        round: rounds.length + 1,
        tallies: roundTallies,
        activeBallotCount,
        majorityThreshold,
        eliminatedId: null,
        winnerId: tie.chosenId,
        tieBreak: tie.tieBreak,
      });
      return { winnerId: tie.chosenId, rounds, finalVotes: winnerVotes };
    }

    const lowestVotes = roundTallies[roundTallies.length - 1]!.votes;
    const lowestIds = roundTallies.filter((tally) => tally.votes === lowestVotes).map((tally) => tally.id);
    const tie = lowestIds.length === 1
      ? { chosenId: lowestIds[0] as T, tieBreak: null }
      : breakTie(lowestIds, 'eliminate', originalFirstChoiceVotes, totalMentions, rng);

    rounds.push({
      round: rounds.length + 1,
      tallies: roundTallies,
      activeBallotCount,
      majorityThreshold,
      eliminatedId: tie.chosenId,
      winnerId: null,
      tieBreak: tie.tieBreak,
    });

    // tie.chosenId is always one of the remaining candidates
    remainingCandidateIds.splice(remainingCandidateIds.indexOf(tie.chosenId), 1);
  }

  return { winnerId: fallback, rounds, finalVotes: 0 };
}
