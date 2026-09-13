import type { DraftGameType } from '../../../types/drafting.types.js';

export class DraftError extends Error {
  public readonly code: 'VALIDATION' | 'NO_POOL';

  public constructor(code: DraftError['code'], message: string) {
    super(message);
    this.name = 'DraftError';
    this.code = code;
  }
}

export const LEGACY_CIV7_FFA_CIVS_PER_PLAYER = 4;
export const LEGACY_CIV7_DUEL_CIVS_PER_PLAYER = 4;

function teamTargetCiv7Civs(teams: number): number {
  if (teams === 2) return 7;
  if (teams === 3 || teams === 4) return 5;
  return 4;
}

export function getCiv7CivTarget(gameType: DraftGameType, groupCount: number): number {
  if (gameType === 'Duel') return LEGACY_CIV7_DUEL_CIVS_PER_PLAYER;
  if (gameType === 'FFA') return LEGACY_CIV7_FFA_CIVS_PER_PLAYER;
  return teamTargetCiv7Civs(groupCount);
}
