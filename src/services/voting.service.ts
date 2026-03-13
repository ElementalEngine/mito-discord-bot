import {
  type Guild,
  type Message,
  type User,
} from 'discord.js';
import { randomUUID } from 'node:crypto';

import { getVoteDurationMs } from '../config/draft.config.js';
import { buildGameVoteConfig } from './voting/domain/questions.service.js';
import { buildRenderPayload, type PublicVotePayload } from './voting/panels/public-message.service.js';
import {
  isVoteVoiceBusy,
  reserveVoteVoice,
  releaseReservedVoteVoice,
  registerActiveVoteSession,
  scheduleVoteSessionTimeout,
} from './voting/runtime/session-runtime.service.js';
import { openInitialVoteMessages } from './voting/runtime/message-ops.service.js';
import { closeVote } from './voting/completion.service.js';
import type {
  GameVoteSession,
  GameVoteVoter,
  StartGameVoteOptions,
  StartGameVoteResult,
} from '../types/voting.types.js';

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
