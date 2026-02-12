import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Message,
} from 'discord.js';
import { randomUUID } from 'node:crypto';

import { EMOJI_ERROR, EMOJI_FAIL } from '../config/constants.js';
import { buildSecretVoteEmbed } from '../ui/embeds/secretvote.js';
import type {
  SecretVoteChoice,
  SecretVoteOutcome,
  SecretVoteStatus,
  SecretVoteAction,
  StartSecretVoteOptions,
  StartSecretVoteResult,
} from '../types/secretvote.js';

const VOTE_DURATION_MS = 2 * 60_000;

type VoteChoice = SecretVoteChoice;

type SecretVote = {
  voteId: string;
  guildId: string;
  voiceChannelId: string;
  hostId: string;
  action: SecretVoteAction;
  turn: number;
  details: string;

  voters: readonly { id: string; displayName: string }[];

  startedAtMs: number;
  endsAtMs: number;

  awaiting: Set<string>;
  votes: Map<string, VoteChoice>;
  dmMessages: Map<string, Message<false>>;

  publicMessage: Message<true>;

  timeout: NodeJS.Timeout;
  updateChain: Promise<void>;
  isFinalized: boolean;
};

const activeByVoice = new Map<string, SecretVote>();
const reservedByVoice = new Set<string>();
const activeById = new Map<string, SecretVote>();

function voiceKey(guildId: string, voiceChannelId: string): string {
  return `${guildId}:${voiceChannelId}`;
}

function buildVoteButtons(
  voteId: string,
  voterId: string
): ActionRowBuilder<ButtonBuilder> {
  const yes = new ButtonBuilder()
    .setCustomId(`sv:${voteId}:${voterId}:YES`)
    .setLabel('YES')
    .setStyle(ButtonStyle.Success);

  const no = new ButtonBuilder()
    .setCustomId(`sv:${voteId}:${voterId}:NO`)
    .setLabel('NO')
    .setStyle(ButtonStyle.Danger);

  return new ActionRowBuilder<ButtonBuilder>().addComponents(yes, no);
}

export function computeSecretVoteOutcome(
  voterIds: readonly string[],
  votes: ReadonlyMap<string, VoteChoice>
): SecretVoteOutcome {
  let yes = 0;
  let no = 0;

  const voterSet = new Set(voterIds);

  for (const [id, choice] of votes) {
    if (!voterSet.has(id)) continue;
    if (choice === 'YES') yes++;
    else no++;
  }

  const nonVoterIds = voterIds.filter((id) => !votes.has(id));
  yes += nonVoterIds.length; // default YES

  const outcome: 'PASSED' | 'FAILED' = yes > no ? 'PASSED' : 'FAILED'; // tie fails
  return { yes, no, outcome, nonVoterIds };
}

function buildStatus(
  v: SecretVote,
  isFinal: boolean,
  result?: SecretVoteStatus['result']
): SecretVoteStatus {
  return {
    voteId: v.voteId,
    action: v.action,
    turn: v.turn,
    details: v.details,
    hostId: v.hostId,
    startedAtMs: v.startedAtMs,
    endsAtMs: v.endsAtMs,
    voters: v.voters,
    votedIds: new Set(v.votes.keys()),
    awaitingIds: new Set(v.awaiting),
    isFinal,
    result,
  };
}

function computeResult(v: SecretVote): NonNullable<SecretVoteStatus['result']> {
  return computeSecretVoteOutcome(v.voters.map((x) => x.id), v.votes);
}

async function safeEditPublic(v: SecretVote, embed: SecretVoteStatus): Promise<void> {
  const built = buildSecretVoteEmbed(embed);
  await v.publicMessage.edit({
    embeds: [built],
    allowedMentions: { parse: [] as const },
  });
}

async function updatePublic(v: SecretVote): Promise<void> {
  v.updateChain = v.updateChain
    .then(async () => {
      await safeEditPublic(v, buildStatus(v, false));
    })
    .catch(() => {
      // keep chain alive even if one edit fails
    });

  await v.updateChain;
}

async function finalizeVote(v: SecretVote, reason: 'timeout' | 'complete'): Promise<void> {
  if (v.isFinalized) return;
  v.isFinalized = true;

  clearTimeout(v.timeout);

  const result = computeResult(v);
  const status = buildStatus(v, true, result);

  try {
    await safeEditPublic(v, status);
  } catch (err) {
    console.error('Failed to publish secret vote final embed', {
      err,
      voteId: v.voteId,
      guildId: v.guildId,
      voiceChannelId: v.voiceChannelId,
      reason,
    });
  }

  // Best-effort: disable remaining DM buttons
  for (const [_voterId, msg] of v.dmMessages) {
    try {
      if (!msg.editable) continue;
      await msg.edit({
        content:
          reason === 'timeout'
            ? '⏱️ Vote ended. No vote defaulted to YES.'
            : '✅ Vote ended. Thanks!',
        components: [],
        allowedMentions: { parse: [] as const },
      });
    } catch {
      // ignore
    }
  }

  activeByVoice.delete(voiceKey(v.guildId, v.voiceChannelId));
  activeById.delete(v.voteId);
}

async function rollbackDMs(messages: Message<false>[]): Promise<void> {
  await Promise.allSettled(
    messages.map((m) => m.delete().catch(() => undefined))
  );
}

export async function startSecretVote(
  opts: StartSecretVoteOptions
): Promise<StartSecretVoteResult> {
  const g = opts.guild;
  const key = voiceKey(g.id, opts.voiceChannelId);

  if (reservedByVoice.has(key) || activeByVoice.has(key)) {
    return {
      ok: false,
      kind: 'ACTIVE_VOTE',
      message: `${EMOJI_FAIL} A secret vote is already running for that voice channel.`,
    };
  }

  reservedByVoice.add(key);

  const voteId = randomUUID();
  const startedAtMs = Date.now();
  const endsAtMs = startedAtMs + VOTE_DURATION_MS;

  // Preflight + send DMs (abort if any fails)
  const dmMessages = new Map<string, Message<false>>();
  const sent: Message<false>[] = [];

  for (const voter of opts.voters) {
    try {
      const dm = await voter.user.createDM();
      const msg = await dm.send({
        content: `🔒 Secret vote started by **${opts.host.username}**.\nAction: **${opts.action}** • Turn: **${opts.turn}**\nVote within 2 minutes (no vote = YES).`,
        components: [buildVoteButtons(voteId, voter.id)],
        allowedMentions: { parse: [] as const },
      });
      dmMessages.set(voter.id, msg);
      sent.push(msg);
    } catch (err) {
      await rollbackDMs(sent);
      reservedByVoice.delete(key);

      const name = voter.displayName ? `**${voter.displayName}**` : `<@${voter.id}>`;
      const detail =
        typeof err === 'object' && err !== null && 'code' in err
          ? ` (code ${(err as { code?: unknown }).code ?? 'unknown'})`
          : '';

      return {
        ok: false,
        kind: 'DM_BLOCKED',
        message: `${EMOJI_ERROR} Cannot start vote — I couldn't DM ${name}${detail}. They likely have DMs disabled.`,
      };
    }
  }

  // Send public embed
  let publicMessage: Message<true>;
  try {
    publicMessage = await opts.commandChannel.send({
      embeds: [
        buildSecretVoteEmbed({
          voteId,
          action: opts.action,
          turn: opts.turn,
          details: opts.details,
          hostId: opts.host.id,
          startedAtMs,
          endsAtMs,
          voters: opts.voters.map((v) => ({
            id: v.id,
            displayName: v.displayName,
          })),
          votedIds: new Set(),
          awaitingIds: new Set(opts.voters.map((v) => v.id)),
          isFinal: false,
        }),
      ],
      allowedMentions: { parse: [] as const },
    }) as Message<true>;
  } catch (err) {
    await rollbackDMs([...dmMessages.values()]);
    reservedByVoice.delete(key);
    console.error('Failed to send secret vote public embed', { err, guildId: g.id });
    return {
      ok: false,
      kind: 'SEND_FAILED',
      message: `${EMOJI_ERROR} I couldn't post the public vote embed in this channel.`,
    };
  }

  const vote: SecretVote = {
    voteId,
    guildId: g.id,
    voiceChannelId: opts.voiceChannelId,
    hostId: opts.host.id,
    action: opts.action,
    turn: opts.turn,
    details: opts.details,
    voters: opts.voters.map((v) => ({ id: v.id, displayName: v.displayName })),
    startedAtMs,
    endsAtMs,
    awaiting: new Set(opts.voters.map((v) => v.id)),
    votes: new Map(),
    dmMessages,
    publicMessage,
    isFinalized: false,
    timeout: setTimeout(() => {
      const current = activeById.get(voteId);
      if (current) void finalizeVote(current, 'timeout');
    }, VOTE_DURATION_MS),
    updateChain: Promise.resolve(),
  };

  reservedByVoice.delete(key);

  activeByVoice.set(key, vote);
  activeById.set(voteId, vote);

  return { ok: true, voteId, publicMessageUrl: publicMessage.url };
}

type RecordSecretVoteResult =
  | Readonly<{ ok: false; kind: 'NOT_ACTIVE'; message: string }>
  | Readonly<{ ok: false; kind: 'ALREADY_VOTED'; message: string }>
  | Readonly<{ ok: true; kind: 'RECORDED'; isComplete: boolean }>;

export async function recordSecretVoteChoice(
  voteId: string,
  voterId: string,
  choice: VoteChoice
): Promise<RecordSecretVoteResult> {
  const vote = activeById.get(voteId);
  if (!vote) {
    return {
      ok: false,
      kind: 'NOT_ACTIVE',
      message: `${EMOJI_FAIL} This vote is no longer active.`,
    };
  }

  if (!vote.awaiting.has(voterId)) {
    return {
      ok: false,
      kind: 'ALREADY_VOTED',
      message: `${EMOJI_FAIL} Your vote was already recorded.`,
    };
  }

  vote.votes.set(voterId, choice);
  vote.awaiting.delete(voterId);

  await updatePublic(vote);

  if (vote.awaiting.size === 0) {
    await finalizeVote(vote, 'complete');
    return { ok: true, kind: 'RECORDED', isComplete: true };
  }

  return { ok: true, kind: 'RECORDED', isComplete: false };
}
