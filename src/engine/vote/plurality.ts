import { createHash } from 'node:crypto';

import type { VoteQuestion } from '../../shared/vote.types.js';
import type { VoteRecord } from './tally.js';
import { voteCountByOption } from './tally.js';

export type QuestionTiebreak = Readonly<{
  questionId: string;
  tied: readonly string[];
  winnerId: string;
  seed: string;
}>;

export type QuestionWinner = Readonly<{
  winnerId: string;
  tiebreak: QuestionTiebreak | null;
}>;

function pickDeterministic(
  sessionId: string,
  questionId: string,
  optionIds: readonly string[]
): { winnerId: string; seed: string } {
  const seedFull = createHash('sha256')
    .update(`${sessionId}:${questionId}`)
    .digest('hex');
  const seed = seedFull.slice(0, 8);
  const n = Number.parseInt(seed, 16);
  // callers only tiebreak among 2+ tied options, so the modulus is safe
  const idx = n % optionIds.length;
  return { winnerId: optionIds[idx] as string, seed };
}

export function resolveQuestionWinner(
  sessionId: string,
  question: VoteQuestion,
  record: VoteRecord,
  voterIds: readonly string[]
): QuestionWinner {
  if (record.size < voterIds.length) {
    return { winnerId: question.defaultOptionId, tiebreak: null };
  }

  const counts = voteCountByOption(question, record);
  const entries = [...counts.entries()].sort((a, b) => b[1] - a[1]);

  if (entries.length === 0) {
    return { winnerId: question.defaultOptionId, tiebreak: null };
  }

  const max = (entries[0] as [string, number])[1];
  const tied = entries.filter(([, count]) => count === max).map(([id]) => id);

  if (tied.length === 1) {
    return { winnerId: tied[0] as string, tiebreak: null };
  }

  const { winnerId, seed } = pickDeterministic(sessionId, question.id, tied);
  return {
    winnerId,
    tiebreak: { questionId: question.id, tied, winnerId, seed },
  };
}

export type LockedSettings = Readonly<{
  locked: ReadonlyMap<string, string>;
  tiebreaks: readonly QuestionTiebreak[];
}>;

/**
 * Compute the locked value for every question (legacy ensureLockedAll
 * semantics for a fresh lock pass: no record → default; otherwise the
 * plurality winner with the deterministic tiebreak).
 */
export function lockAllQuestions(args: Readonly<{
  sessionId: string;
  questions: readonly VoteQuestion[];
  votesByQuestion: ReadonlyMap<string, VoteRecord>;
  voterIds: readonly string[];
}>): LockedSettings {
  const locked = new Map<string, string>();
  const tiebreaks: QuestionTiebreak[] = [];

  for (const question of args.questions) {
    const record = args.votesByQuestion.get(question.id);
    if (!record) {
      locked.set(question.id, question.defaultOptionId);
      continue;
    }

    const winner = resolveQuestionWinner(args.sessionId, question, record, args.voterIds);
    locked.set(question.id, winner.winnerId);
    if (winner.tiebreak) tiebreaks.push(winner.tiebreak);
  }

  return { locked, tiebreaks };
}

/** Legacy getDraftMode parity over pre-computed locked settings. */
export function getDraftModeFromLocked(
  questions: readonly VoteQuestion[],
  locked: ReadonlyMap<string, string>
): string {
  const q = questions.find((question) => question.id === 'draft_mode');
  if (!q) return 'standard';

  const optId = locked.get(q.id) ?? q.defaultOptionId;
  const opt = q.options.find((option) => option.id === optId);
  return opt?.id ?? 'standard';
}
