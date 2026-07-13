import { CIV6_LEADERS } from '../../data/civ6.data.js';
import { CIV7_CIVS, CIV7_LEADERS } from '../../data/civ7.data.js';
import type { Civ6DraftResult, Civ7DraftResult } from '../../shared/draft.types.js';
import type { RandomSource } from '../random.js';
import { pickItem, shuffledCopy } from '../random.js';
import type { DraftSessionConfig } from '../types.js';
import {
  generateDirectCiv6DraftCore,
  generateDirectCiv7DraftCore,
} from './allocation.js';
import { buildKeyedCivPool, buildKeyedLeaderPool } from './pools.js';
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

export type RandomDraftAssignment = Readonly<{
  seatId: string;
  leaderKey: string;
  civKey?: string;
}>;

export type RandomDraftResult = Readonly<{
  edition: DraftSessionConfig['edition'];
  assignments: readonly RandomDraftAssignment[];
}>;

/** Legacy drawAssignments parity: shuffled slice when the pool suffices, with-replacement picks otherwise. */
function drawAssignments(pool: readonly string[], count: number, rng: RandomSource): string[] {
  if (count <= 0) return [];
  if (pool.length >= count) {
    return shuffledCopy(pool, rng).slice(0, count);
  }

  return Array.from({ length: count }, () => pickItem(pool, rng));
}

/** INSTANT: random vote draft (legacy runRandomDraftMode semantics, data-only result — presentation stays in the feature layer). */
export function resolveRandomDraft(config: DraftSessionConfig, rng: RandomSource): RandomDraftResult {
  const leaderPool = buildKeyedLeaderPool({
    edition: config.edition,
    bannedLeaderKeys: config.bannedLeaderKeys,
  });
  if (leaderPool.length === 0) {
    throw new DraftError('NO_POOL', 'No leaders remain after bans.');
  }

  if (config.edition === 'CIV6') {
    const leaderAssignments = drawAssignments(leaderPool, config.seatIds.length, rng);
    return {
      edition: config.edition,
      assignments: config.seatIds.map((seatId, index) => ({
        seatId,
        leaderKey: leaderAssignments[index] as string,
      })),
    };
  }

  const civPool = buildKeyedCivPool({
    edition: config.edition,
    startingAge: config.startingAge,
    bannedCivKeys: config.bannedCivKeys,
  });
  if (civPool.length === 0) {
    throw new DraftError('NO_POOL', 'No civs remain after bans.');
  }

  const leaderAssignments = drawAssignments(leaderPool, config.seatIds.length, rng);
  const civAssignments = drawAssignments(civPool, config.seatIds.length, rng);
  return {
    edition: config.edition,
    assignments: config.seatIds.map((seatId, index) => ({
      seatId,
      leaderKey: leaderAssignments[index] as string,
      civKey: civAssignments[index] as string,
    })),
  };
}

export type DraftFormatDescriptor =
  | Readonly<{ id: 'standard' | 'random'; kind: 'instant' }>
  | Readonly<{ id: 'blind' | 'snake' | 'cwc'; kind: 'interactive' }>;

export const DRAFT_FORMATS: readonly DraftFormatDescriptor[] = [
  { id: 'standard', kind: 'instant' },
  { id: 'random', kind: 'instant' },
  { id: 'blind', kind: 'interactive' },
  { id: 'snake', kind: 'interactive' },
  { id: 'cwc', kind: 'interactive' },
] as const;
