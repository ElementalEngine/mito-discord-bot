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
const PUBLIC_TICK_MS = 10_000;

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
  tick: NodeJS.Timeout;
  lastTickBucket: number;

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
      rule = 'CC: • must be Unanimous (turn 1–80)';
      passed = no === 0;
    } else if (turn <= 100) {
      rule = 'CC: • max 1 NO (turn 81–100)';
      passed = no <= 1;
    } else {
      rule = 'CC: • max 2 NO (turn 101+)';
      passed = no <= 2;
    }

    if (passed) {
      notes.push(
        'If this CC passes: any player who wants to use a veto must DM the host in game chat within 2 minutes. If no veto is used, the CC passes.'
      );
    }
  } else if (action === 'Scrap') {
    if (turn <= 20) {
      const needed = ceilFrac(total, 2, 3);
      rule = 'Scrap: • must be 2/3 majority (turn 1–20)';
      passed = yes >= needed;
    } else if (turn <= 50) {
      const needed = ceilFrac(total, 3, 4);
      rule = 'Scrap: • must be 3/4 majority (turn 21–50)';
      passed = yes >= needed;
    } else if (turn <= 70) {
      rule = 'Scrap: • max 1 NO (turn 51–70)';
      passed = no <= 1;
    } else {
      rule = 'Scrap: • must be Unanimous (turn 71+)';
      passed = no === 0;
    }
  } else if (action === 'Irrel') {
    if (turn < 50) {
      rule = 'Irrel: • must be Unanimous (turn 1–49)';
      passed = no === 0;
    } else {
      rule = 'Irrel: • max 2 NO (turn 50+)';
      passed = no <= 2;
    }
    notes.push('Irrel eligibility (host verify):');
    notes.push('• bottom two players by score (including AI)');
    notes.push('• not currently holding a veto');
    notes.push('• not involved in an ongoing emergency');
  } else {
    // Remap
    rule = 'Remap: • must be Unanimous (turn ≤10)';
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
  result?: SecretVoteOutcome,
  nowMs?: number
): SecretVoteStatus {
  return {
    voteId: v.voteId,
    action: v.action,
    turn: v.turn,
    details: v.details,
    hostId: v.hostId,
    startedAtMs: v.startedAtMs,
    endsAtMs: v.endsAtMs,
    nowMs,
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

function tickBucket(nowMs: number): number {
  return Math.floor(nowMs / PUBLIC_TICK_MS);
}

function enqueuePublicUpdate(v: SecretVote, nowMs: number, force: boolean): void {
  if (v.isFinalized) return;

  const bucket = tickBucket(nowMs);
  if (!force && bucket === v.lastTickBucket) return;
  v.lastTickBucket = bucket;

  v.updateChain = v.updateChain
    .then(async () => {
      if (v.isFinalized) return;
      await safeEditPublic(v, buildStatus(v, false, undefined, nowMs));
    })
    .catch(() => {
      // keep chain alive
    });
}

async function rollbackDMs(messages: readonly Message<false>[]): Promise<void> {
  await Promise.allSettled(messages.map((m) => m.delete().catch(() => undefined)));
}

async function finalizeVote(v: SecretVote, reason: 'timeout' | 'complete'): Promise<void> {
  if (v.isFinalized) return;
  v.isFinalized = true;

  clearTimeout(v.timeout);
  clearInterval(v.tick);

  // Record the actual end time so the final embed doesn't show a lingering timer.
  v.endsAtMs = Date.now();

  const voterIds = v.voters.map((x) => x.id);
  const result = evaluateSecretVoteOutcome(v.action, v.turn, voterIds, v.votes);

  try {
    await safeEditPublic(v, buildStatus(v, true, result, v.endsAtMs));
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
          content: '⏱️ You didn’t vote in time. Your vote defaulted to YES.',
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

  const dmTasks = opts.voters.map(async (voter) => {
    const dm = await voter.user.createDM();
    const msg = await dm.send({
      content: [
        `🔒 Secret vote started by **${opts.host.username}**.`,
        `Action: **${opts.action}** • Turn: **${opts.turn}**`,
        `Details: ${opts.details}`,
        '',
        'You have 2 minutes to vote.',
        'If you don’t vote before the timer ends, you’ll be counted as YES.',
      ].join('\n'),
      components: [buildVoteButtons(voteId, voter.id)],
      allowedMentions: { parse: [] as const },
    });
    return { voter, msg };
  });

  const dmResults = await Promise.allSettled(dmTasks);
  const firstFailIdx = dmResults.findIndex((r) => r.status === 'rejected');

  for (const r of dmResults) {
    if (r.status === 'fulfilled') {
      dmMessages.set(r.value.voter.id, r.value.msg);
      sent.push(r.value.msg);
    }
  }

  if (firstFailIdx !== -1) {
    await rollbackDMs(sent);
    reservedByVoice.delete(key);

    const voter = opts.voters[firstFailIdx];
    const name = voter.displayName ? `**${voter.displayName}**` : `<@${voter.id}>`;
    return {
      ok: false,
      kind: 'DM_BLOCKED',
      message: `${EMOJI_ERROR} Cannot start vote — I couldn't DM ${name}. They likely have DMs disabled.`,
    };
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
          nowMs: startedAtMs,
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
    lastTickBucket: tickBucket(startedAtMs),
    tick: setInterval(() => {
      const current = activeById.get(voteId);
      if (!current || current.isFinalized) return;
      enqueuePublicUpdate(current, Date.now(), false);
    }, PUBLIC_TICK_MS),
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

  enqueuePublicUpdate(vote, Date.now(), true);

  const isComplete = vote.awaiting.size === 0;
  if (isComplete) {
    void finalizeVote(vote, 'complete');
  }

  return { ok: true, kind: 'RECORDED', isComplete, choice };
}

export function isSecretVoteActive(voteId: string): boolean {
  return activeById.has(voteId);
}
