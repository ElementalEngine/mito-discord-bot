import { randomInt } from 'node:crypto';

import { EMOJI_RANDOM } from '../../config/constants.js';
import { CIV6_LEADERS } from '../../data/civ6.data.js';
import { CIV7_CIVS, CIV7_LEADERS } from '../../data/civ7.data.js';
import type { VoteDraftRequest } from '../../types/draft.types.js';
import { DraftError } from '../draft.service.js';
import type { DraftModeOutput } from '../../types/drafting.types.js';

function pickRandom<T>(arr: readonly T[]): T {
  return arr[randomInt(0, arr.length)];
}

export async function runRandomDraftMode(request: VoteDraftRequest): Promise<DraftModeOutput> {
  if (request.source !== 'vote') {
    throw new DraftError('VALIDATION', 'Random draft is only available from the vote flow.');
  }

  const bannedLeaders = new Set(request.bannedLeaderKeys);
  const bannedCivs = new Set(request.bannedCivKeys);

  if (request.edition === 'CIV6') {
    const pool = Object.keys(CIV6_LEADERS).filter((key) => !bannedLeaders.has(key));
    if (pool.length === 0) {
      throw new DraftError('NO_POOL', 'No leaders remain after bans.');
    }

    const lines = request.voterIds.map((id) => {
      const key = pickRandom(pool);
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

  if (leaderPool.length === 0) {
    throw new DraftError('NO_POOL', 'No leaders remain after bans.');
  }
  if (civPool.length === 0) {
    throw new DraftError('NO_POOL', 'No civs remain after bans.');
  }

  const lines = request.voterIds.map((id) => {
    const leaderKey = pickRandom(leaderPool);
    const civKey = pickRandom(civPool);
    const leader = CIV7_LEADERS[leaderKey as keyof typeof CIV7_LEADERS].gameId;
    const civ = CIV7_CIVS[civKey as keyof typeof CIV7_CIVS].gameId;
    return `• <@${id}> — **${civ}** + **${leader}**`;
  });

  return {
    content: `${EMOJI_RANDOM} **Random civs + leaders**\n${lines.join('\n')}`,
    allowedMentions: { parse: [] as const },
  };
}
