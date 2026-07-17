import type { GameVoteSession, VoteRecord } from '../../../types/voting.types.js';

export function getCommittedVoteRecordForVoter(v: GameVoteSession, voterId: string): VoteRecord {
  const record = new Map<string, string>();
  for (const q of v.questions) {
    const optId = v.votesByQuestion.get(q.id)?.get(voterId);
    if (optId) record.set(q.id, optId);
  }
  return record;
}

export function ensureStagedVoteRecord(v: GameVoteSession, voterId: string): VoteRecord {
  const existing = v.stagedVotesByVoter.get(voterId);
  if (existing) return existing;
  const created = getCommittedVoteRecordForVoter(v, voterId);
  v.stagedVotesByVoter.set(voterId, created);
  return created;
}

export function answeredCountInRecord(v: GameVoteSession, record: ReadonlyMap<string, string>): number {
  let count = 0;
  for (const q of v.questions) if (record.has(q.id)) count += 1;
  return count;
}

export function firstUnansweredQuestionIdInRecord(v: GameVoteSession, record: ReadonlyMap<string, string>): string | null {
  for (const q of v.questions) {
    if (!record.has(q.id)) return q.id;
  }
  return null;
}

export function voteRecordEquals(a: ReadonlyMap<string, string>, b: ReadonlyMap<string, string>): boolean {
  if (a.size !== b.size) return false;
  for (const [key, value] of a) if (b.get(key) !== value) return false;
  return true;
}

export function hasStagedVoteChanges(v: GameVoteSession, voterId: string): boolean {
  return !voteRecordEquals(ensureStagedVoteRecord(v, voterId), getCommittedVoteRecordForVoter(v, voterId));
}

export function commitVoteRecord(v: GameVoteSession, userId: string, record: ReadonlyMap<string, string>): void {
  for (const q of v.questions) {
    const optId = record.get(q.id);
    const rec = v.votesByQuestion.get(q.id) ?? new Map<string, string>();
    if (optId) rec.set(userId, optId);
    else rec.delete(userId);
    v.votesByQuestion.set(q.id, rec);
  }
}

export function nextBallotQuestionId(v: GameVoteSession, voterId: string, currentQuestionId: string): string {
  const currentIndex = v.questions.findIndex((q) => q.id === currentQuestionId);
  if (currentIndex < 0) return currentQuestionId;

  const staged = ensureStagedVoteRecord(v, voterId);
  for (let i = currentIndex + 1; i < v.questions.length; i += 1) {
    const question = v.questions[i];
    if (!staged.has(question.id)) return question.id;
  }

  return v.questions[currentIndex + 1]?.id ?? currentQuestionId;
}
