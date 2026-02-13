import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Message,
  type SendableChannels,
} from 'discord.js';
import { randomUUID } from 'node:crypto';

import { EMOJI_ERROR, EMOJI_FAIL } from '../config/constants.js';
import { buildSecretVoteEmbed } from '../ui/embeds/secretvote.js';
import type {
  SecretVoteAction,
  SecretVoteChoice,
  SecretVoteOutcome,
  SecretVoteStatus,
  StartSecretVoteOptions,
  StartSecretVoteResult,
} from '../types/secretvote.js';

const VOTE_DURATION_MS = 2 * 60_000;

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
  votes: Map<string, SecretVoteChoice>;
  dmMessages: Map<string, Message<false>>;
  publicMessage: Message<true>;

  timeout: NodeJS.Timeout;
  updateChain: Promise<void>;
  isFinalized: boolean;
};

const activeByVoice = new Map<string, SecretVote>();
const activeById = new Map<string, SecretVote>();
const reservedByVoice = new Set<string>();

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

type VoteTally = Readonly<{
  yes: number;
  no: number;
  nonVoterIds: readonly string[];
}>;

function tallyVotes(
  voters: readonly string[],
  votes: ReadonlyMap<string, SecretVoteChoice>
): VoteTally {
  let yes = 0;
  let no = 0;

  const voterSet = new Set(voters);
  for (const [id, choice] of votes) {
    if (!voterSet.has(id)) continue;
    if (choice === 'YES') yes++;
    else no++;
  }

  const nonVoterIds = voters.filter((id) => !votes.has(id));
  yes += nonVoterIds.length; // default YES

  return { yes, no, nonVoterIds };
}

function ceilFrac(total: number, num: number, denom: number): number {
  // ceil(total * num / denom) without floating point drift
  return Math.floor((total * num + (denom - 1)) / denom);
}

export function evaluateSecretVoteOutcome(
  action: SecretVoteAction,
  turn: number,
  voters: readonly string[],
  votes: ReadonlyMap<string, SecretVoteChoice>
): SecretVoteOutcome {
  const total = voters.length;
  const { yes, no, nonVoterIds } = tallyVotes(voters, votes);

  let passed = false;
  let rule = '';
  const notes: string[] = [];

  if (action === 'CC') {
    if (turn <= 80) {
      rule = 'CC: Unanimous (turn 1–80)';
      passed = no === 0;
    } else if (turn <= 100) {
      rule = 'CC: All but 1 (turn 81–100)';
      passed = no <= 1;
    } else {
      rule = 'CC: All but 2 (turn 101+)';
      passed = no <= 2;
    }
    if (passed) {
      notes.push(
        'If this CC passes: any player who wants to use a veto must DM the host in game chat. If no veto is used, the CC passes.'
      );
    }
  } else if (action === 'Scrap') {
    if (turn <= 20) {
      const needed = ceilFrac(total, 2, 3);
      rule = `Scrap: 2/3 majority (need ${needed}/${total} YES)`;
      passed = yes >= needed;
    } else if (turn <= 50) {
      const needed = ceilFrac(total, 3, 4);
      rule = `Scrap: 3/4 majority (need ${needed}/${total} YES)`;
      passed = yes >= needed;
    } else if (turn <= 70) {
      rule = 'Scrap: All but 1 (turn 51–70)';
      passed = no <= 1;
    } else {
      rule = 'Scrap: Unanimous (turn 71+)';
      passed = no === 0;
    }
  } else if (action === 'Irrel') {
    if (turn < 50) {
      rule = 'Irrel: Unanimous (turn 1–49)';
      passed = no === 0;
    } else {
      rule = 'Irrel: All but 2 (turn 50+)';
      passed = no <= 2;
    }
    notes.push('Irrel eligibility (host verify):');
    notes.push('• bottom two players by score (including AI)');
    notes.push('• not currently holding a veto');
    notes.push('• not involved in an ongoing emergency');
  } else {
    // Remap
    rule = 'Remap: Unanimous (turn ≤10)';
    passed = no === 0;
  }

  return {
    yes,
    no,
    outcome: passed ? 'PASSED' : 'FAILED',
    nonVoterIds,
    rule,
    notes: notes.length > 0 ? notes : undefined,
  };
}

function buildStatus(
  v: SecretVote,
  isFinal: boolean,
  result?: SecretVoteOutcome
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

async function safeEditPublic(v: SecretVote, status: SecretVoteStatus): Promise<void> {
  await v.publicMessage.edit({
    embeds: [buildSecretVoteEmbed(status)],
    allowedMentions: { parse: [] as const },
  });
}

async function updatePublic(v: SecretVote): Promise<void> {
  if (v.isFinalized) return;

  v.updateChain = v.updateChain
    .then(async () => {
      if (v.isFinalized) return;
      await safeEditPublic(v, buildStatus(v, false));
    })
    .catch(() => {
      // keep chain alive
    });

  await v.updateChain;
}

async function rollbackDMs(messages: readonly Message<false>[]): Promise<void> {
  await Promise.allSettled(messages.map((m) => m.delete().catch(() => undefined)));
}

async function finalizeVote(v: SecretVote, reason: 'timeout' | 'complete'): Promise<void> {
  if (v.isFinalized) return;
  v.isFinalized = true;

  clearTimeout(v.timeout);
  // Record the actual end time so the final embed doesn't show a lingering countdown.
  v.endsAtMs = Date.now();

  const voterIds = v.voters.map((x) => x.id);
  const result = evaluateSecretVoteOutcome(v.action, v.turn, voterIds, v.votes);

  try {
    await safeEditPublic(v, buildStatus(v, true, result));
  } catch (err) {
    console.error('Failed to publish secret vote final embed', {
      err,
      voteId: v.voteId,
      guildId: v.guildId,
      voiceChannelId: v.voiceChannelId,
      reason,
    });
  }

  // DM finalization:
  // - Only notify non-voters (defaulted YES). Never overwrite a voted confirmation.
  if (reason === 'timeout' && result.nonVoterIds.length > 0) {
    await Promise.allSettled(
      result.nonVoterIds.map(async (id) => {
        const msg = v.dmMessages.get(id);
        if (!msg?.editable) return;
        await msg.edit({
          content: '⏱️ You didn’t vote in time. Your vote was counted as YES.',
          components: [],
          allowedMentions: { parse: [] as const },
        });
      })
    );
  } else {
    // Best-effort: remove components on any still-awaiting messages.
    await Promise.allSettled(
      [...v.awaiting].map(async (id) => {
        const msg = v.dmMessages.get(id);
        if (!msg?.editable) return;
        await msg.edit({
          components: [],
          allowedMentions: { parse: [] as const },
        });
      })
    );
  }

  activeByVoice.delete(voiceKey(v.guildId, v.voiceChannelId));
  activeById.delete(v.voteId);
}

export async function startSecretVote(
  opts: StartSecretVoteOptions
): Promise<StartSecretVoteResult> {
  if (opts.voters.length < 2) {
    return {
      ok: false,
      kind: 'TOO_FEW_VOTERS',
      message: `${EMOJI_FAIL} A secret vote requires at least **2** eligible voters.`,
    };
  }

  const key = voiceKey(opts.guild.id, opts.voiceChannelId);
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

  // Preflight DM requirement: abort if ANY DM fails.
  const dmMessages = new Map<string, Message<false>>();
  const sent: Message<false>[] = [];

  for (const voter of opts.voters) {
    try {
      const dm = await voter.user.createDM();
      const msg = await dm.send({
        content: [
          `🔒 Secret vote started by **${opts.host.username}**.`,
          `Action: **${opts.action}** • Turn: **${opts.turn}**`,
          `Details: ${opts.details}`,
          '',
          'Voting is by DM. If you don’t vote before the timer ends, you’ll be counted as YES.',
        ].join('\n'),
        components: [buildVoteButtons(voteId, voter.id)],
        allowedMentions: { parse: [] as const },
      });
      dmMessages.set(voter.id, msg);
      sent.push(msg);
    } catch {
      await rollbackDMs(sent);
      reservedByVoice.delete(key);

      const name = voter.displayName ? `**${voter.displayName}**` : `<@${voter.id}>`;
      return {
        ok: false,
        kind: 'DM_BLOCKED',
        message: `${EMOJI_ERROR} Cannot start vote — I couldn't DM ${name}. They likely have DMs disabled.`,
      };
    }
  }

  // Send the public status embed
  let publicMessage: Message<true>;
  try {
    publicMessage = (await (opts.commandChannel as SendableChannels).send({
      embeds: [
        buildSecretVoteEmbed({
          voteId,
          action: opts.action,
          turn: opts.turn,
          details: opts.details,
          hostId: opts.host.id,
          startedAtMs,
          endsAtMs,
          voters: opts.voters.map((v) => ({ id: v.id, displayName: v.displayName })),
          votedIds: new Set(),
          awaitingIds: new Set(opts.voters.map((v) => v.id)),
          isFinal: false,
        }),
      ],
      allowedMentions: { parse: [] as const },
    })) as Message<true>;
  } catch {
    await rollbackDMs([...dmMessages.values()]);
    reservedByVoice.delete(key);
    return {
      ok: false,
      kind: 'SEND_FAILED',
      message: `${EMOJI_ERROR} I couldn't post the public vote embed in this channel.`,
    };
  }

  const vote: SecretVote = {
    voteId,
    guildId: opts.guild.id,
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
    updateChain: Promise.resolve(),
    timeout: setTimeout(() => {
      const current = activeById.get(voteId);
      if (current) void finalizeVote(current, 'timeout');
    }, VOTE_DURATION_MS),
  };

  reservedByVoice.delete(key);
  activeByVoice.set(key, vote);
  activeById.set(voteId, vote);

  return { ok: true, voteId, publicMessageUrl: publicMessage.url };
}

export type RecordSecretVoteResult =
  | Readonly<{ ok: false; kind: 'NOT_ACTIVE'; message: string }>
  | Readonly<{ ok: false; kind: 'ALREADY_VOTED'; message: string }>
  | Readonly<{ ok: false; kind: 'NOT_ELIGIBLE'; message: string }>
  | Readonly<{ ok: true; kind: 'RECORDED'; isComplete: boolean; choice: SecretVoteChoice }>;

export async function recordSecretVoteChoice(
  voteId: string,
  voterId: string,
  choice: SecretVoteChoice
): Promise<RecordSecretVoteResult> {
  const vote = activeById.get(voteId);
  if (!vote) {
    return {
      ok: false,
      kind: 'NOT_ACTIVE',
      message: `${EMOJI_FAIL} This vote is no longer active.`,
    };
  }

  const voterSet = new Set(vote.voters.map((v) => v.id));
  if (!voterSet.has(voterId)) {
    return {
      ok: false,
      kind: 'NOT_ELIGIBLE',
      message: `${EMOJI_FAIL} You're not eligible to vote in this poll.`,
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
    return { ok: true, kind: 'RECORDED', isComplete: true, choice };
  }

  return { ok: true, kind: 'RECORDED', isComplete: false, choice };
}

export function isSecretVoteActive(voteId: string): boolean {
  return activeById.has(voteId);
}
