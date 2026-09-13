import type { CivEdition } from './types.js';
import type { Civ7StartingAge } from '../data/types.js';

export const DRAFT_BAN_LIMITS = {
  CIV6: { leader: 25, civ: 0 },
  CIV7: { leader: 10, civWhenAgeNone: 15, civWhenAgeSpecific: 5 },
} as const;

export const DRAFT_TIMERS_MS = {
  vote: { CIV6: 10 * 60_000, CIV7: 10 * 60_000 },
  blind: 10 * 60_000,
} as const;

export function getGameVoteBanLimits(edition: CivEdition, startingAge?: Civ7StartingAge) {
  if (edition === 'CIV6') {
    return DRAFT_BAN_LIMITS.CIV6;
  }

  return {
    leader: DRAFT_BAN_LIMITS.CIV7.leader,
    civ: startingAge === 'None'
      ? DRAFT_BAN_LIMITS.CIV7.civWhenAgeNone
      : DRAFT_BAN_LIMITS.CIV7.civWhenAgeSpecific,
  } as const;
}

export function getVoteDurationMs(edition: CivEdition): number {
  return DRAFT_TIMERS_MS.vote[edition];
}
