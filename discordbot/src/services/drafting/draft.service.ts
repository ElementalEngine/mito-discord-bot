import type {
  Civ6DraftRequest,
  Civ6DraftResult,
  Civ7DraftRequest,
  Civ7DraftResult,
  DraftCommandRequest,
  VoteDraftRequest,
} from '../../types/drafting.types.js';
import { CIV6_LEADERS } from '../../data/civ6.data.js';
import { CIV7_CIVS, CIV7_LEADERS } from '../../data/civ7.data.js';
import {
  generateCiv6DraftCore,
  generateCiv7DraftCore,
  generateDirectCiv6DraftCore,
  generateDirectCiv7DraftCore,
} from './domain/allocation.service.js';

export { DraftError } from './domain/rules.service.js';

function keysToColonTokens(
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

function resolveLeaderBansRaw(request: DraftCommandRequest | VoteDraftRequest): string | undefined {
  if (request.source === 'command') return request.leaderBansRaw;
  return request.edition === 'CIV6'
    ? keysToColonTokens(request.bannedLeaderKeys, CIV6_LEADERS)
    : keysToColonTokens(request.bannedLeaderKeys, CIV7_LEADERS);
}

function resolveCivBansRaw(request: DraftCommandRequest | VoteDraftRequest): string | undefined {
  if (request.source === 'command') return request.civBansRaw;
  if (request.edition !== 'CIV7') return undefined;
  return keysToColonTokens(request.bannedCivKeys, CIV7_CIVS);
}

export function buildVoteStandardDraftResult(request: VoteDraftRequest): Civ6DraftResult | Civ7DraftResult {
  const leaderBansRaw = resolveLeaderBansRaw(request);

  if (request.edition === 'CIV6') {
    return generateDirectCiv6Draft({
      gameType: request.gameType,
      numberPlayers: request.numberPlayers,
      numberTeams: request.numberTeams,
      leaderBansRaw,
    });
  }

  return generateDirectCiv7Draft({
    gameType: request.gameType,
    startingAge: request.startingAge ?? 'Antiquity_Age',
    numberPlayers: request.numberPlayers,
    numberTeams: request.numberTeams,
    leaderBansRaw,
    civBansRaw: resolveCivBansRaw(request),
  });
}

export function buildCommandStandardDraftResult(request: DraftCommandRequest): Civ6DraftResult | Civ7DraftResult {
  if (request.edition === 'CIV6') {
    return generateDirectCiv6Draft({
      gameType: request.gameType,
      numberPlayers: request.numberPlayers,
      numberTeams: request.numberTeams,
      leaderBansRaw: request.leaderBansRaw,
    });
  }

  return generateDirectCiv7Draft({
    gameType: request.gameType,
    startingAge: request.startingAge ?? 'Antiquity_Age',
    numberPlayers: request.numberPlayers,
    numberTeams: request.numberTeams,
    leaderBansRaw: request.leaderBansRaw,
    civBansRaw: request.civBansRaw,
  });
}

export function generateCiv6Draft(req: Civ6DraftRequest): Civ6DraftResult {
  return generateCiv6DraftCore(req);
}

export function generateDirectCiv6Draft(req: Civ6DraftRequest): Civ6DraftResult {
  return generateDirectCiv6DraftCore(req);
}

export function generateCiv7Draft(req: Civ7DraftRequest): Civ7DraftResult {
  return generateCiv7DraftCore(req);
}

export function generateDirectCiv7Draft(req: Civ7DraftRequest): Civ7DraftResult {
  return generateDirectCiv7DraftCore(req);
}
