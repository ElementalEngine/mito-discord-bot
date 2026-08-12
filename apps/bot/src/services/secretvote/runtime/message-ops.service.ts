import { Message, type SendableChannels } from 'discord.js';

import { buildSecretVoteButtons } from '../../../ui/components/secretvote.js';
import { buildSecretVoteEmbed } from '../../../ui/embeds/secretvote.js';
import type {
  SecretVoteAction,
  SecretVoteOutcome,
  SecretVoteSession,
  SecretVoteStatus,
} from '../../../types/secretvote.types.js';
import type { VoterUser } from '../../../utils/types.js';
import { SECRET_VOTE_DURATION_LABEL } from './deadline.service.js';

const DISCORD_MESSAGE_MAX = 2_000;
const DM_CONCURRENCY = 10;

type SecretVoteInitialStatus = Readonly<{
  voteId: string;
  action: SecretVoteAction;
  turn: number;
  details: string;
  hostId: string;
  startedAtMs: number;
  endsAtMs: number;
  voters: readonly { id: string; displayName: string }[];
}>;

type SecretVoteDmSendResult =
  | Readonly<{
      ok: true;
      dmMessages: ReadonlyMap<string, Message<false>>;
    }>
  | Readonly<{
      ok: false;
      failedVoter: VoterUser;
      sentMessages: readonly Message<false>[];
    }>;

function clampText(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function buildVoteDmContent(
  hostUsername: string,
  action: SecretVoteAction,
  turn: number,
  details: string
): string {
  const prefix = [
    `🔎 Secret vote started by **${hostUsername}**.`,
    `Action: **${action}** • Turn: **${turn}**`,
    'Details: ',
  ].join('\n');
  const suffix = [
    '',
    `You have ${SECRET_VOTE_DURATION_LABEL} to vote.`,
    'If you don’t vote before the timer ends, you’ll be counted as YES.',
  ].join('\n');

  const safeMaxDetails = Math.max(
    1,
    DISCORD_MESSAGE_MAX - prefix.length - suffix.length - 1
  );

  return `${prefix}${clampText(details, safeMaxDetails)}${suffix}`;
}

async function forEachLimit<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<void>
): Promise<void> {
  if (items.length === 0) return;
  const concurrency = Math.max(1, Math.min(limit, items.length));
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      try {
        await fn(items[index], index);
      } catch {
        // best effort
      }
    }
  }

  await Promise.allSettled(Array.from({ length: concurrency }, () => worker()));
}

function normalizeComparable(value: unknown): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (Array.isArray(value)) return value.map((entry) => normalizeComparable(entry));
  if (typeof value === 'object') {
    if ('toJSON' in value && typeof (value as { toJSON?: unknown }).toJSON === 'function') {
      return normalizeComparable((value as { toJSON: () => unknown }).toJSON());
    }
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => [key, normalizeComparable(entry)]);
    return Object.fromEntries(entries);
  }
  return value;
}

function normalizedJson(value: unknown): string {
  return JSON.stringify(normalizeComparable(value));
}

async function safeEditPublic(
  session: SecretVoteSession,
  status: SecretVoteStatus
): Promise<void> {
  if (!session.publicMessage.editable) return;
  const embed = buildSecretVoteEmbed(status);
  if (normalizedJson([embed]) === normalizedJson(session.publicMessage.embeds)) {
    return;
  }
  await session.publicMessage.edit({
    embeds: [embed],
    allowedMentions: { parse: [] as const },
  });
}

export function buildSecretVoteStatus(
  session: SecretVoteSession,
  isFinal: boolean,
  result?: SecretVoteOutcome
): SecretVoteStatus {
  return {
    voteId: session.voteId,
    action: session.action,
    turn: session.turn,
    details: session.details,
    hostId: session.hostId,
    startedAtMs: session.startedAtMs,
    endsAtMs: session.endsAtMs,
    voters: session.voters,
    votedIds: new Set(session.votes.keys()),
    awaitingIds: new Set(session.awaiting),
    isFinal,
    result,
  };
}

export function buildInitialSecretVoteStatus(
  initial: SecretVoteInitialStatus
): SecretVoteStatus {
  return {
    ...initial,
    votedIds: new Set(),
    awaitingIds: new Set(initial.voters.map((voter) => voter.id)),
    isFinal: false,
  };
}

export function requestSecretVotePublicRender(
  session: SecretVoteSession,
  status: SecretVoteStatus
): void {
  if (session.phase !== 'collecting' && !status.isFinal) return;

  session.pendingStatus = status;
  session.needsRender = true;

  if (session.editInFlight) return;
  session.editInFlight = true;

  void (async () => {
    while (true) {
      const next = session.pendingStatus;
      session.needsRender = false;
      if (!next) break;
      try {
        await safeEditPublic(session, next);
      } catch {
        // best effort
      }
      if (!session.needsRender) break;
    }
    session.editInFlight = false;
  })();
}

export async function sendSecretVoteDmPrompts(options: Readonly<{
  voteId: string;
  hostUsername: string;
  action: SecretVoteAction;
  turn: number;
  details: string;
  voters: readonly VoterUser[];
}>): Promise<SecretVoteDmSendResult> {
  const dmMessages = new Map<string, Message<false>>();
  const sentMessages: Message<false>[] = [];
  let firstFailedVoter: VoterUser | null = null;
  let nextIndex = 0;
  const concurrency = Math.max(1, Math.min(DM_CONCURRENCY, options.voters.length));

  async function worker(): Promise<void> {
    while (true) {
      const index = nextIndex++;
      if (index >= options.voters.length) return;
      if (firstFailedVoter) return;

      const voter = options.voters[index];
      try {
        const dm = await voter.user.createDM();
        const message = await dm.send({
          content: buildVoteDmContent(
            options.hostUsername,
            options.action,
            options.turn,
            options.details
          ),
          components: [buildSecretVoteButtons(options.voteId, voter.id)],
          allowedMentions: { parse: [] as const },
        });
        dmMessages.set(voter.id, message);
        sentMessages.push(message);
      } catch {
        if (!firstFailedVoter) firstFailedVoter = voter;
        return;
      }
    }
  }

  await Promise.allSettled(Array.from({ length: concurrency }, () => worker()));

  if (firstFailedVoter) {
    return {
      ok: false,
      failedVoter: firstFailedVoter,
      sentMessages,
    };
  }

  return { ok: true, dmMessages };
}

export async function rollbackSecretVoteDmMessages(
  messages: readonly Message<false>[]
): Promise<void> {
  await forEachLimit(messages, DM_CONCURRENCY, async (message) => {
    await message.delete().catch(() => undefined);
  });
}

export async function sendSecretVotePublicMessage(
  commandChannel: SendableChannels,
  status: SecretVoteStatus
): Promise<Message<true>> {
  return (await commandChannel.send({
    embeds: [buildSecretVoteEmbed(status)],
    allowedMentions: { parse: [] as const },
  })) as Message<true>;
}

export async function disableSecretVoteDmButtons(
  session: SecretVoteSession,
  voterIds: readonly string[]
): Promise<void> {
  await forEachLimit(voterIds, DM_CONCURRENCY, async (voterId) => {
    const message = session.dmMessages.get(voterId);
    if (!message?.editable) return;
    await message.edit({
      components: [],
      allowedMentions: { parse: [] as const },
    });
  });
}

export async function notifySecretVoteTimedOutVoters(
  session: SecretVoteSession,
  voterIds: readonly string[]
): Promise<void> {
  await forEachLimit(voterIds, DM_CONCURRENCY, async (voterId) => {
    const message = session.dmMessages.get(voterId);
    if (!message?.editable) return;
    await message.edit({
      content: '⏱️ You didn’t vote in time. Your vote defaulted to YES.',
      components: [],
      allowedMentions: { parse: [] as const },
    });
  });
}
