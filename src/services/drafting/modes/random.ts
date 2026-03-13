import type { VoteDraftRequest } from '../../../types/drafting.types.js';
import type { DraftModeOutput } from '../../../types/drafting.types.js';
import { EMOJI_RANDOM } from '../../../config/constants.js';
import { lookupCiv6LeaderMeta } from '../../../data/civ6.data.js';
import { lookupCiv7CivMeta, lookupCiv7LeaderMeta } from '../../../data/civ7.data.js';
import {
  renderMentionHumanizedPairLine,
  renderMentionHumanizedSingleLine,
} from '../domain/labels.service.js';
import {
  buildVoteCivPool,
  buildVoteLeaderPool,
  pickRandomPoolItem,
  shuffledPoolCopy,
} from '../domain/pool.service.js';
import { DraftError } from '../draft.service.js';

function drawAssignments<T>(pool: readonly T[], count: number): T[] {
  if (count <= 0) return [];
  if (pool.length >= count) {
    return shuffledPoolCopy(pool).slice(0, count);
  }

  return Array.from({ length: count }, () => pickRandomPoolItem(pool));
}

export async function runRandomDraftMode(request: VoteDraftRequest): Promise<DraftModeOutput> {
  if (request.source !== 'vote') {
    throw new DraftError('VALIDATION', 'Random draft is only available from the vote flow.');
  }

  const leaderPool = buildVoteLeaderPool(request);
  if (leaderPool.length === 0) {
    throw new DraftError('NO_POOL', 'No leaders remain after bans.');
  }

  if (request.edition === 'CIV6') {
    const leaderAssignments = drawAssignments(leaderPool, request.voterIds.length);
    const lines = request.voterIds.map((id, index) => (
      renderMentionHumanizedSingleLine(id, lookupCiv6LeaderMeta(leaderAssignments[index]), leaderAssignments[index])
    ));

    return {
      content: `Vote UUID: \`${request.voteUuid}\`\n${EMOJI_RANDOM} **Random leaders**\n${lines.join('\n')}`,
      allowedMentions: { parse: [] as const },
    };
  }

  const civPool = buildVoteCivPool(request);
  if (civPool.length === 0) {
    throw new DraftError('NO_POOL', 'No civs remain after bans.');
  }

  const leaderAssignments = drawAssignments(leaderPool, request.voterIds.length);
  const civAssignments = drawAssignments(civPool, request.voterIds.length);
  const lines = request.voterIds.map((id, index) => (
    renderMentionHumanizedPairLine(
      id,
      lookupCiv7CivMeta(civAssignments[index]),
      civAssignments[index],
      lookupCiv7LeaderMeta(leaderAssignments[index]),
      leaderAssignments[index],
    )
  ));

  return {
    content: `Vote UUID: \`${request.voteUuid}\`\n${EMOJI_RANDOM} **Random civs + leaders**\n${lines.join('\n')}`,
    allowedMentions: { parse: [] as const },
  };
}
