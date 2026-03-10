import type { CivEdition } from './types.js';
import type { Civ7StartingAge } from '../data/types.js';
import type { DraftGameType } from '../types/draft.types.js';

export const DRAFT_LIMITS = {
  CIV6: {
    FFA: { minUsers: 2, maxUsers: 14 },
    Teamer: { minUsers: 2, maxUsers: 16, minTeams: 2, maxTeams: 5 },
    Duel: { minUsers: 2, maxUsers: 2 },
  },
  CIV7: {
    FFA: { minUsers: 2, maxUsers: 10 },
    Teamer: { minUsers: 2, maxUsers: 10, minTeams: 2, maxTeams: 5 },
    Duel: { minUsers: 2, maxUsers: 2 },
  },
} as const;

export const DRAFT_BAN_LIMITS = {
  CIV6: { leader: 25, civ: 0 },
  CIV7: { leader: 10, civWhenAgeNone: 15, civWhenAgeSpecific: 5 },
} as const;

export const ACTIVE_VOTE_LIMITS = {
  CIV6: { FFA: 2, Teamer: 2, Duel: 2 },
  CIV7: { FFA: 1, Teamer: 1, Duel: 1 },
} as const satisfies Record<CivEdition, Record<DraftGameType, number>>;

export const DRAFT_TIMERS_MS = {
  vote: { CIV6: 10 * 60_000, CIV7: 10 * 60_000 },
  blind: 10 * 60_000,
  snakePick: 3 * 60_000,
  cwcCaptainSelect: 5 * 60_000,
  cwcPick: 60_000,
} as const;

export const CWC_PICK_ORDER = [0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1] as const;

export function getDraftLimits(edition: CivEdition) {
  return DRAFT_LIMITS[edition];
}

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
