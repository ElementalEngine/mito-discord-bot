import {
  type Guild,
  type Message,
  type User,
} from 'discord.js';
import { randomUUID } from 'node:crypto';

import { getVoteDurationMs } from '../config/draft.config.js';
import { buildGameVoteConfig } from './voting/domain/questions.service.js';
import { getDraftMode, ensureLockedAll } from './voting/domain/tiebreak.service.js';
import { majorityBans } from './voting/domain/bans.service.js';
import { executeVoteDraft } from './drafting/orchestration.service.js';
import { buildRenderPayload, type PublicVotePayload } from './voting/panels/public-message.service.js';
import { isVoteVoiceBusy, reserveVoteVoice, releaseReservedVoteVoice, registerActiveVoteSession, scheduleVoteSessionTimeout, clearVoteSessionTimeout, finalizeVoteSessionCleanup } from './voting/runtime/session-runtime.service.js';
import { safeEditMessage, openInitialVoteMessages } from './voting/runtime/message-ops.service.js';
import type {
  GameVoteSession,
  GameVoteVoter,
  StartGameVoteOptions,
  StartGameVoteResult,
} from '../types/voting.types.js';
import type { VoteDraftRequest } from '../types/drafting.types.js';

const COMPLETED_SESSION_RETENTION_MS = 15 * 60_000;

type RenderPayload = PublicVotePayload;

function formatUnknownError(err: unknown): string {
  if (!err || typeof err !== 'object') return '';
  const name = 'name' in err && typeof (err as { name?: unknown }).name === 'string'
    ? (err as { name: string }).name
    : '';
  const message = 'message' in err && typeof (err as { message?: unknown }).message === 'string'
    ? (err as { message: string }).message
    : '';
  if (name && message) return `${name}: ${message}`;
  return name || message;
}

async function openInitialMessages(
  v: GameVoteSession,
  guild: Guild
): Promise<{ ok: true } | { ok: false; message: string }> {
  let payload: RenderPayload;
  try {
    payload = buildRenderPayload(v);
  } catch (err: unknown) {
    console.error('gamevote initial render failed', {
      sessionId: v.sessionId,
      guildId: v.guildId,
      channelId: 'id' in v.commandChannel ? v.commandChannel.id : undefined,
      edition: v.edition,
      gameType: v.gameType,
      error: err,
    });
    const detail = formatUnknownError(err);
    const extra = detail ? ` (${detail})` : '';
    return { ok: false, message: `⚠️ I couldn't build the vote message${extra}.` };
  }

  return openInitialVoteMessages(v, guild, payload);
}

async function finalizeCleanup(v: GameVoteSession, retainCompletedForMs = 0): Promise<void> {
  await finalizeVoteSessionCleanup(v, retainCompletedForMs);
}

function buildVoteDraftRequest(v: GameVoteSession): VoteDraftRequest {
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
    bannedLeaderKeys: majorityBans(v.voterIds, leaderPerVoter),
    bannedCivKeys: v.edition === 'CIV7' ? majorityBans(v.voterIds, civPerVoter) : [],
    voterUsersById: v.voterUsersById,
    publicMessage: v.publicMessage,
  };
}

async function publishDraftResult(request: VoteDraftRequest): Promise<void> {
  await executeVoteDraft(request);
}


async function closeVote(v: GameVoteSession): Promise<void> {
  if (v.isFinalized || v.status === 'closed') return;

  clearVoteSessionTimeout(v);

  v.phase = 'final';
  v.status = 'closed';
  v.isFinalized = true;

  await safeEditMessage(v.publicMessage, buildRenderPayload(v));
  await finalizeCleanup(v);
}

export async function finalizeCompletedVote(v: GameVoteSession): Promise<void> {
  if (v.isFinalized) return;
  if (v.status !== 'in_progress') return;

  clearVoteSessionTimeout(v);

  ensureLockedAll(v);
  v.status = 'completed';
  v.completedAtMs = Date.now();
  v.phase = 'final';
  v.isFinalized = true;

  const request = buildVoteDraftRequest(v);
  const completedPayload = buildRenderPayload(v);

  await safeEditMessage(v.publicMessage, completedPayload);
  try {
    await publishDraftResult(request);
  } finally {
    await safeEditMessage(v.publicMessage, completedPayload);
    await finalizeCleanup(v, COMPLETED_SESSION_RETENTION_MS);
  }
}



export async function startGameVote(args: StartGameVoteOptions): Promise<StartGameVoteResult> {
  if (isVoteVoiceBusy(args.guild.id, args.voiceChannelId)) {
    return { ok: false, message: '⚠️ A vote is already running for that voice channel.' };
  }

  reserveVoteVoice(args.guild.id, args.voiceChannelId);

  try {
    const sessionId = randomUUID();

    const voters: GameVoteVoter[] = args.voters.map((x) => ({
      id: x.user.id,
      displayName: x.displayName,
    }));

    const voterIds = voters.map((v) => v.id);

    const voterUsersById = new Map<string, User>();
    for (const v of args.voters) voterUsersById.set(v.user.id, v.user);

    const { questions } = buildGameVoteConfig({ edition: args.edition, gameType: args.gameType });

    const now = Date.now();

    const v: GameVoteSession = {
      sessionId,
      guildId: args.guild.id,
      voiceChannelId: args.voiceChannelId,
      commandChannel: args.commandChannel,

      hostId: args.host.id,
      edition: args.edition,
      gameType: args.gameType,
      startingAge: args.startingAge,
      numberTeams: args.numberTeams,

      voters,
      voterIds,
      voterUsersById,

      startedAtMs: now,
      endsAtMs: now + getVoteDurationMs(args.edition),
      completedAtMs: null,

      phase: 'voting',
      status: 'in_progress',
      questions,

      votesByQuestion: new Map(),
      lockedSettings: new Map(),
      tiebrokenQuestions: new Set(),
      activeQuestionByVoter: new Map(),

      bansByVoter: new Map(),
      stagedBansByVoter: new Map(),
      bansSubmitted: new Set(),
      banPages: new Map(),
      voteSubmitted: new Set(),
      stagedVotesByVoter: new Map(),
      finished: new Set(),

      publicMessage: null as unknown as Message<true>,

      timeout: null,
      isFinalized: false,
    };

    scheduleVoteSessionTimeout(v, () => void closeVote(v), getVoteDurationMs(args.edition));

    const init = await openInitialMessages(v, args.guild);
    if (!init.ok) {
      if (v.timeout) { clearTimeout(v.timeout); v.timeout = null; }
      return { ok: false, message: init.message };
    }

    registerActiveVoteSession(v);

    return { ok: true, sessionId };
  } finally {
    releaseReservedVoteVoice(args.guild.id, args.voiceChannelId);
  }
}
