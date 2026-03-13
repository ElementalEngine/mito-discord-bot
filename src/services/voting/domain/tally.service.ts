import type { VoteQuestion } from '../../../config/types.js';
import type { VoteRecord } from '../../../types/voting.types.js';

const MULTI_VALUE_DELIMITER = '|';

function dedupeStable(keys: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const key of keys) {
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

export function getQuestionMaxSelections(question: VoteQuestion): number {
  return Math.max(1, Math.min(question.options.length, question.maxSelections ?? 1));
}

export function isMultiSelectQuestion(question: VoteQuestion): boolean {
  return getQuestionMaxSelections(question) > 1;
}

export function decodeVoteSelections(question: VoteQuestion, stored?: string): string[] {
  if (!stored) return [];
  if (!isMultiSelectQuestion(question)) return [stored].filter(Boolean);

  const allowed = new Set(question.options.map((option) => option.id));
  return dedupeStable(
    stored
      .split(MULTI_VALUE_DELIMITER)
      .map((value) => value.trim())
      .filter((value) => allowed.has(value))
  ).slice(0, getQuestionMaxSelections(question));
}

export function encodeVoteSelections(
  question: VoteQuestion,
  selectedIds: readonly string[]
): string | null {
  const allowed = new Set(question.options.map((option) => option.id));
  const orderById = new Map(
    question.options.map((option, index) => [option.id, index] as const)
  );
  const normalized = dedupeStable(selectedIds)
    .filter((value) => allowed.has(value))
    .sort((a, b) => (orderById.get(a) ?? 0) - (orderById.get(b) ?? 0))
    .slice(0, getQuestionMaxSelections(question));

  if (normalized.length === 0) return null;
  return isMultiSelectQuestion(question)
    ? normalized.join(MULTI_VALUE_DELIMITER)
    : normalized[0] ?? null;
}

function pickRandom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function pickRandomVoteValue(question: VoteQuestion): string {
  if (!isMultiSelectQuestion(question)) return pickRandom(question.options).id;

  const count = Math.max(
    1,
    Math.min(
      getQuestionMaxSelections(question),
      1 + Math.floor(Math.random() * getQuestionMaxSelections(question))
    )
  );
  const pool = question.options.map((option) => option.id);
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  return encodeVoteSelections(question, pool.slice(0, count)) ?? question.defaultOptionId;
}

export function voteCountByOption(
  question: VoteQuestion,
  record: VoteRecord
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const stored of record.values()) {
    for (const optId of decodeVoteSelections(question, stored)) {
      counts.set(optId, (counts.get(optId) ?? 0) + 1);
    }
  }
  return counts;
}
