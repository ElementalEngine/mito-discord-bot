import type { CivEdition } from '../../../config/types.js';
import type { BlindDraftPick, SnakeDraftPick, SnakeRoundKind } from '../../../types/drafting.types.js';

type DraftPickType = 'leader' | 'civ';
type SharedDraftPick = { leaderKey?: string; civKey?: string };

export function applyStagedPickSelection<T extends SharedDraftPick>(
  current: T | undefined,
  pickType: DraftPickType,
  key: string,
): T {
  const next = { ...(current ?? {}) };
  if (pickType === 'leader') next.leaderKey = key;
  else next.civKey = key;
  return next as T;
}

export function isBlindDraftSubmissionReady(edition: CivEdition, pick?: BlindDraftPick): boolean {
  return edition === 'CIV6'
    ? Boolean(pick?.leaderKey)
    : Boolean(pick?.leaderKey) && Boolean(pick?.civKey);
}

export function isSnakeDraftSubmissionReady(
  round: Exclude<SnakeRoundKind, 'complete'>,
  pick?: SnakeDraftPick,
): boolean {
  return round === 'leader' ? Boolean(pick?.leaderKey) : Boolean(pick?.civKey);
}
