import { CIV6_LEADERS } from '../../data/civ6.data.js';
import { CIV7_CIVS, CIV7_LEADERS } from '../../data/civ7.data.js';
import type { Civ6DraftResult, Civ7DraftResult, DraftGameType } from '../../shared/draft.types.js';
import type { RandomSource } from '../random.js';
import type { DraftSessionConfig } from '../types.js';
import {
  generateDirectCiv6DraftCore,
  generateDirectCiv7DraftCore,
} from './allocation.js';
import { DraftError } from './errors.js';

/** Replica of the frozen legacy keysToColonTokens (draft.service.ts:20–45). */
export function keysToColonTokens(
  keys: readonly string[],
  source: Readonly<Record<string, { gameId: string }>>,
): string | undefined {
  const value = keys
    .map((key) => {
      const meta = source[key];
      return meta?.gameId ? `:${meta.gameId}:` : '';
    })
    .filter(Boolean)
    .join('\n');

  return value || undefined;
}

function resolveLeaderBansRaw(config: DraftSessionConfig): string | undefined {
  return config.edition === 'CIV6'
    ? keysToColonTokens(config.bannedLeaderKeys, CIV6_LEADERS)
    : keysToColonTokens(config.bannedLeaderKeys, CIV7_LEADERS);
}

export function resolveVoteStandardDraft(
  config: DraftSessionConfig,
  rng: RandomSource,
): Civ6DraftResult | Civ7DraftResult {
  const numberPlayers = config.gameType === 'FFA' ? config.seatIds.length : undefined;
  const numberTeams = config.gameType === 'Teamer' ? config.numberTeams : undefined;
  const leaderBansRaw = resolveLeaderBansRaw(config);

  if (config.edition === 'CIV6') {
    return generateDirectCiv6DraftCore(
      {
        gameType: config.gameType,
        numberPlayers,
        numberTeams,
        leaderBansRaw,
      },
      rng,
    );
  }

  return generateDirectCiv7DraftCore(
    {
      gameType: config.gameType,
      startingAge: config.startingAge ?? 'Antiquity_Age',
      numberPlayers,
      numberTeams,
      leaderBansRaw,
      civBansRaw: keysToColonTokens(config.bannedCivKeys, CIV7_CIVS),
    },
    rng,
  );
}

export type DraftFormatId = 'standard' | 'blind' | 'snake' | 'cwc';

export type DraftFormatDescriptor = Readonly<{
  id: DraftFormatId;
  kind: 'instant' | 'interactive';
  gameTypes: readonly DraftGameType[];
  /** Legacy-parity notice raised when the format is used with an illegal game type. */
  unavailableMessage: string;
}>;

export const DRAFT_FORMATS: readonly DraftFormatDescriptor[] = [
  {
    id: 'standard',
    kind: 'instant',
    gameTypes: ['FFA', 'Teamer', 'Duel'],
    unavailableMessage: 'Standard draft is not available for this game type.',
  },
  {
    id: 'blind',
    kind: 'interactive',
    gameTypes: ['FFA', 'Duel'],
    unavailableMessage: 'Blind draft is only available for FFA or Duel votes.',
  },
  {
    id: 'snake',
    kind: 'interactive',
    gameTypes: ['FFA', 'Duel'],
    unavailableMessage: 'Snake draft is only available for FFA or Duel votes.',
  },
  {
    id: 'cwc',
    kind: 'interactive',
    gameTypes: ['Teamer'],
    unavailableMessage: 'CWC is only available for Teamer votes.',
  },
] as const;

export function getDraftFormat(id: DraftFormatId): DraftFormatDescriptor {
  return DRAFT_FORMATS.find((format) => format.id === id) as DraftFormatDescriptor;
}

export function isDraftFormatAllowed(id: DraftFormatId, gameType: DraftGameType): boolean {
  return getDraftFormat(id).gameTypes.includes(gameType);
}

/** Creation-time gate. Throws the legacy notice for the format (DraftError parity). */
export function assertDraftFormatAllowed(id: DraftFormatId, gameType: DraftGameType): void {
  const format = getDraftFormat(id);
  if (!format.gameTypes.includes(gameType)) {
    throw new DraftError('VALIDATION', format.unavailableMessage);
  }
}
