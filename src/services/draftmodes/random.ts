import { randomInt } from 'node:crypto';

import { EMOJI_RANDOM } from '../../config/constants.js';
import { CIV6_LEADERS } from '../../data/civ6.data.js';
import { CIV7_CIVS, CIV7_LEADERS } from '../../data/civ7.data.js';
import type { VoteDraftRequest } from '../../types/draft.js';
import { DraftError } from '../draft.service.js';
import type { DraftModeOutput } from '../../types/drafting.types.js';

function shuffle<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = randomInt(0, i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

export async function runRandomDraftMode(request: VoteDraftRequest): Promise<DraftModeOutput> {
  if (request.source !== 'vote') {
    throw new DraftError('VALIDATION', 'Random draft is only available from the vote flow.');
  }

  const bannedLeaders = new Set(request.bannedLeaderKeys);
  const bannedCivs = new Set(request.bannedCivKeys);

  if (request.edition === 'CIV6') {
    const leaderPool = Object.keys(CIV6_LEADERS).filter((key) => !bannedLeaders.has(key));
    if (leaderPool.length < request.voterIds.length) {
      throw new DraftError('NO_POOL', 'Not enough leaders remain after bans.');
    }

    shuffle(leaderPool);
    const lines = request.voterIds.map((id, index) => {
      const key = leaderPool[index];
      return `• <@${id}> — **${CIV6_LEADERS[key as keyof typeof CIV6_LEADERS].gameId}**`;
    });

    return {
      content: `${EMOJI_RANDOM} **Random leaders**\n${lines.join('\n')}`,
      allowedMentions: { parse: [] as const },
    };
  }

  const leaderPool = Object.keys(CIV7_LEADERS).filter((key) => !bannedLeaders.has(key));
  const allowAllAges = request.startingAge === 'None';
  const civPool = Object.entries(CIV7_CIVS)
    .filter(([key, meta]) => !bannedCivs.has(key) && (allowAllAges || meta.agePool === request.startingAge))
    .map(([key]) => key);

  if (leaderPool.length < request.voterIds.length) {
    throw new DraftError('NO_POOL', 'Not enough leaders remain after bans.');
  }
  if (civPool.length === 0) {
    throw new DraftError('NO_POOL', 'No civs remain after bans.');
  }
  if (allowAllAges && civPool.length < request.voterIds.length) {
    throw new DraftError('NO_POOL', 'Not enough civs remain after bans.');
  }

  shuffle(leaderPool);
  shuffle(civPool);
  const lines = request.voterIds.map((id, index) => {
    const leaderKey = leaderPool[index];
    const civKey = civPool[index % civPool.length];
    const leader = CIV7_LEADERS[leaderKey as keyof typeof CIV7_LEADERS].gameId;
    const civ = CIV7_CIVS[civKey as keyof typeof CIV7_CIVS].gameId;
    return `• <@${id}> — **${civ}** + **${leader}**`;
  });

  return {
    content: `${EMOJI_RANDOM} **Random civs + leaders**\n${lines.join('\n')}`,
    allowedMentions: { parse: [] as const },
  };
}
