import type { Civ6DraftResult, Civ7DraftResult, DraftCommandRequest, VoteDraftRequest } from '../../types/draft.js';
import { CIV6_LEADERS } from '../../data/civ6.data.js';
import { CIV7_CIVS, CIV7_LEADERS } from '../../data/civ7.data.js';
import {
  buildCiv6DirectDraftSummaryEmbed,
  buildCiv6VoteDraftSummaryEmbed,
  buildCiv7DirectDraftSummaryEmbed,
  buildCiv7VoteDraftSummaryEmbed,
} from '../../ui/embeds/draft.js';
import {
  buildCiv6DirectDraftMessages,
  buildCiv6VoteDraftMessages,
  buildCiv7DirectDraftMessages,
  buildCiv7VoteDraftMessages,
} from '../../ui/layouts/draft.js';
import type { DraftModeOutput } from '../../types/drafting.types.js';
import { generateCiv6Draft, generateCiv7Draft } from '../draft.service.js';

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

export function buildStandardDraftResult(request: DraftCommandRequest | VoteDraftRequest): Civ6DraftResult | Civ7DraftResult {
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

function asFollowUps(messages: readonly string[]) {
  return messages.map((content) => ({
    content,
    allowedMentions: { parse: [] as const },
  }));
}

export async function runStandardDraftMode(
  request: DraftCommandRequest | VoteDraftRequest,
): Promise<DraftModeOutput> {
  if (request.edition === 'CIV6') {
    const draft = buildStandardDraftResult(request) as Civ6DraftResult;
    return request.source === 'command'
      ? {
          embeds: [buildCiv6DirectDraftSummaryEmbed(draft)],
          followUps: asFollowUps(buildCiv6DirectDraftMessages(draft)),
        }
      : {
          embeds: [buildCiv6VoteDraftSummaryEmbed(draft)],
          followUps: asFollowUps(buildCiv6VoteDraftMessages(draft, request.voterIds)),
        };
  }

  const draft = buildStandardDraftResult(request) as Civ7DraftResult;
  return request.source === 'command'
    ? {
        embeds: [buildCiv7DirectDraftSummaryEmbed(draft)],
        followUps: asFollowUps(buildCiv7DirectDraftMessages(draft)),
      }
    : {
        embeds: [buildCiv7VoteDraftSummaryEmbed(draft)],
        followUps: asFollowUps(buildCiv7VoteDraftMessages(draft, request.voterIds)),
      };
}
