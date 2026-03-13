import { randomInt } from 'node:crypto';

import { EMOJI_RANDOM } from '../../../config/constants.js';
import { CIV6_LEADERS, formatCiv6Leader, lookupCiv6Leader } from '../../../data/civ6.data.js';
import {
  CIV7_CIVS,
  CIV7_LEADERS,
  formatCiv7Civ,
  formatCiv7Leader,
  lookupCiv7Civ,
  lookupCiv7Leader,
} from '../../../data/civ7.data.js';
import { humanizeGameId } from '../../../utils/humanize-game-id.js';
import type { VoteDraftRequest } from '../../../types/drafting.types.js';
import { DraftError } from '../draft.service.js';
import type { DraftModeOutput } from '../../../types/drafting.types.js';

function pickRandom<T>(arr: readonly T[]): T {
  return arr[randomInt(0, arr.length)];
}

function shuffle<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = randomInt(0, i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function drawAssignments<T>(pool: readonly T[], count: number): T[] {
  if (count <= 0) return [];
  if (pool.length >= count) {
    const copy = pool.slice();
    shuffle(copy);
    return copy.slice(0, count);
  }

  return Array.from({ length: count }, () => pickRandom(pool));
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

    const leaderAssignments = drawAssignments(pool, request.voterIds.length);

    const lines = request.voterIds.map((id, index) => {
      const key = leaderAssignments[index];
      return `• <@${id}> — ${formatCiv6Leader(key)} ${humanizeGameId(lookupCiv6Leader(key))}`;
    });

    return {
      content: `Vote UUID: \`${request.voteUuid}\`\n${EMOJI_RANDOM} **Random leaders**\n${lines.join('\n')}`,
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

  const leaderAssignments = drawAssignments(leaderPool, request.voterIds.length);
  const civAssignments = drawAssignments(civPool, request.voterIds.length);

  const lines = request.voterIds.map((id, index) => {
    const leaderKey = leaderAssignments[index];
    const civKey = civAssignments[index];
    return `• <@${id}> — ${formatCiv7Civ(civKey)} ${humanizeGameId(lookupCiv7Civ(civKey))} + ${formatCiv7Leader(leaderKey)} ${humanizeGameId(lookupCiv7Leader(leaderKey))}`;
  });

  return {
    content: `Vote UUID: \`${request.voteUuid}\`\n${EMOJI_RANDOM} **Random civs + leaders**\n${lines.join('\n')}`,
    allowedMentions: { parse: [] as const },
  };
}
