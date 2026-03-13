import type {
  Civ6DraftResult,
  Civ7DraftResult,
  DraftCommandRequest,
  VoteDraftRequest,
} from '../../../types/drafting.types.js';
import type { DraftModeOutput } from '../../../types/drafting.types.js';
import { CIV6_LEADERS } from '../../../data/civ6.data.js';
import { CIV7_CIVS, CIV7_LEADERS } from '../../../data/civ7.data.js';
import {
  buildCiv6DirectDraftSummaryEmbed,
  buildCiv6DraftEmbed,
  buildCiv7DirectDraftSummaryEmbed,
  buildCiv7DraftEmbed,
} from '../../../ui/embeds/draft.js';
import {
  buildCiv6DirectDraftMessages,
  buildCiv7DirectDraftMessages,
} from '../../../ui/layouts/draft.js';
import {
  generateCiv6Draft,
  generateCiv7Draft,
  generateDirectCiv6Draft,
  generateDirectCiv7Draft,
} from '../draft.service.js';

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

export function buildStandardDraftResult(
  request: DraftCommandRequest | VoteDraftRequest,
): Civ6DraftResult | Civ7DraftResult {
  const leaderBansRaw = resolveLeaderBansRaw(request);

  if (request.edition === 'CIV6') {
    return generateCiv6Draft({
      gameType: request.gameType,
      numberPlayers: request.numberPlayers,
      numberTeams: request.numberTeams,
      leaderBansRaw,
    });
  }

  return generateCiv7Draft({
    gameType: request.gameType,
    startingAge: request.startingAge ?? 'Antiquity_Age',
    numberPlayers: request.numberPlayers,
    numberTeams: request.numberTeams,
    leaderBansRaw,
    civBansRaw: resolveCivBansRaw(request),
  });
}

function buildDirectStandardDraftResult(request: DraftCommandRequest): Civ6DraftResult | Civ7DraftResult {
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

function buildCommandOutput(draft: Civ6DraftResult | Civ7DraftResult): DraftModeOutput {
  const messages = draft.gameVersion === 'civ6'
    ? buildCiv6DirectDraftMessages(draft)
    : buildCiv7DirectDraftMessages(draft);

  const followUps = messages.map((content) => ({
    content,
    allowedMentions: { parse: [] as const },
  }));

  if (draft.gameVersion === 'civ6') {
    return {
      embeds: [buildCiv6DirectDraftSummaryEmbed(draft)],
      allowedMentions: { parse: [] as const },
      followUps,
    };
  }

  return {
    embeds: [buildCiv7DirectDraftSummaryEmbed(draft)],
    allowedMentions: { parse: [] as const },
    followUps,
  };
}

export async function runStandardDraftMode(
  request: DraftCommandRequest | VoteDraftRequest,
): Promise<DraftModeOutput> {
  if (request.source === 'command') {
    const draft = buildDirectStandardDraftResult(request);
    return buildCommandOutput(draft);
  }

  if (request.edition === 'CIV6') {
    const draft = buildStandardDraftResult(request) as Civ6DraftResult;
    return { embeds: [buildCiv6DraftEmbed(draft)] };
  }

  const draft = buildStandardDraftResult(request) as Civ7DraftResult;
  return { embeds: [buildCiv7DraftEmbed(draft)] };
}
