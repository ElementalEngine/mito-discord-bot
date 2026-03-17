import type { VoteDraftRequest } from '../../types/drafting.types.js';
import type { GameVoteSession } from '../../types/voting.types.js';
import { executeVoteDraft } from '../drafting/orchestration.service.js';
import { majorityBans } from './domain/bans.service.js';
import { getDraftMode, ensureLockedAll } from './domain/tiebreak.service.js';
import { buildRenderPayload } from './panels/public-message.service.js';
import { safeEditMessage } from './runtime/message-ops.service.js';
import {
  clearVoteSessionTimeout,
  finalizeVoteSessionCleanup,
} from './runtime/session-runtime.service.js';

const COMPLETED_SESSION_RETENTION_MS = 15 * 60_000;

function uniqueStable(keys: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const key of keys) {
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

export function buildVoteDraftRequest(v: GameVoteSession): VoteDraftRequest {
  const leaderPerVoter = new Map<string, ReadonlySet<string>>();
  const civPerVoter = new Map<string, ReadonlySet<string>>();

  for (const [id, bans] of v.bansByVoter.entries()) {
    if (bans.leaderKeys.length > 0) leaderPerVoter.set(id, new Set(bans.leaderKeys));
    if (v.edition === 'CIV7' && bans.civKeys.length > 0) civPerVoter.set(id, new Set(bans.civKeys));
  }

  return {
    source: 'vote',
    voteUuid: v.sessionId,
    edition: v.edition,
    draftMode: getDraftMode(v),
    gameType: v.gameType,
    startingAge: v.startingAge,
    numberPlayers: v.gameType === 'FFA' ? v.voters.length : undefined,
    numberTeams: v.gameType === 'Teamer' ? v.numberTeams : undefined,
    voterIds: v.voterIds,
    hostId: v.hostId,
    commandChannel: v.commandChannel,
    bannedLeaderKeys: uniqueStable([...v.hostLeaderBanKeys, ...majorityBans(v.voterIds, leaderPerVoter)]),
    bannedCivKeys: v.edition === 'CIV7'
      ? uniqueStable([...v.hostCivBanKeys, ...majorityBans(v.voterIds, civPerVoter)])
      : [],
    voterUsersById: v.voterUsersById,
    publicMessage: v.publicMessage,
  };
}

async function publishDraftResult(request: VoteDraftRequest): Promise<void> {
  await executeVoteDraft(request);
}

async function finalizeCleanup(v: GameVoteSession, retainCompletedForMs = 0): Promise<void> {
  await finalizeVoteSessionCleanup(v, retainCompletedForMs);
}

export async function closeVote(v: GameVoteSession): Promise<void> {
  if (v.isFinalized || v.status === 'closed') return;

  clearVoteSessionTimeout(v);

  v.phase = 'final';
  v.status = 'closed';
  v.isFinalized = true;

  await safeEditMessage(v.publicMessage, buildRenderPayload(v));
  await finalizeCleanup(v);
}

export function markVoteCompleted(v: GameVoteSession): VoteDraftRequest {
  clearVoteSessionTimeout(v);

  ensureLockedAll(v);
  v.status = 'completed';
  v.completedAtMs = Date.now();
  v.phase = 'final';
  v.isFinalized = true;

  return buildVoteDraftRequest(v);
}

export async function finalizeCompletedVote(v: GameVoteSession): Promise<void> {
  if (v.isFinalized) return;
  if (v.status !== 'in_progress') return;

  const request = markVoteCompleted(v);
  const completedPayload = buildRenderPayload(v);

  await safeEditMessage(v.publicMessage, completedPayload);
  try {
    await publishDraftResult(request);
  } finally {
    await safeEditMessage(v.publicMessage, completedPayload);
    await finalizeCleanup(v, COMPLETED_SESSION_RETENTION_MS);
  }
}
