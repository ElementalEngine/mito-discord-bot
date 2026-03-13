import { createHash } from 'node:crypto';

import type { VoteQuestion } from '../../../config/types.js';
import type { GameVoteDraftMode, GameVoteSession, VoteRecord } from '../../../types/voting.types.js';
import { voteCountByOption } from './tally.service.js';

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
  const idx = optionIds.length > 0 ? n % optionIds.length : 0;
  return { winnerId: optionIds[Math.max(0, idx)], seed };
}

export function selectWinner(
  sessionId: string,
  question: VoteQuestion,
  record: VoteRecord,
  voterIds: readonly string[],
  tiebrokenQuestions: Set<string>
): string {
  if (record.size < voterIds.length) return question.defaultOptionId;

  const counts = voteCountByOption(question, record);
  const entries = [...counts.entries()].sort((a, b) => b[1] - a[1]);

  if (entries.length === 0) return question.defaultOptionId;

  const max = entries[0][1];
  const tied = entries.filter(([, count]) => count === max).map(([id]) => id);

  if (tied.length === 1) return tied[0];

  const { winnerId, seed } = pickDeterministic(sessionId, question.id, tied);
  tiebrokenQuestions.add(question.id);

  console.info('[gamevote] tiebreak', {
    sessionId,
    questionId: question.id,
    tied,
    winnerId,
    seed,
  });

  return winnerId;
}

export function ensureLockedAll(v: GameVoteSession): void {
  for (const q of v.questions) {
    if (v.lockedSettings.has(q.id)) continue;

    const record = v.votesByQuestion.get(q.id);
    if (!record) {
      v.lockedSettings.set(q.id, q.defaultOptionId);
      continue;
    }

    const winner = selectWinner(
      v.sessionId,
      q,
      record,
      v.voterIds,
      v.tiebrokenQuestions
    );
    v.lockedSettings.set(q.id, winner);
  }
}

export function getDraftMode(v: GameVoteSession): GameVoteDraftMode {
  ensureLockedAll(v);

  const q = v.questions.find((question) => question.id === 'draft_mode');
  if (!q) return 'standard';

  const optId = v.lockedSettings.get(q.id) ?? q.defaultOptionId;
  const opt = q.options.find((option) => option.id === optId);
  return (opt?.id as GameVoteDraftMode) ?? 'standard';
}
