import { randomUUID } from 'node:crypto';

import type {
  ButtonInteraction,
  Message,
  MessageCreateOptions,
  MessageEditOptions,
  StringSelectMenuInteraction,
} from 'discord.js';

import { EMOJI_ERROR } from '../../config/constants.js';
import { DRAFT_TIMERS_MS } from '../../config/draft.config.js';
import type { VoteDraftRequest } from '../../types/draft.js';
import type {
  BlindDraftAssignment,
  BlindDraftPageState,
  BlindDraftSession,
  DraftModeOutput,
} from '../../types/drafting.types.js';
import { buildBlindDraftPickComponents, clampBlindDraftPageState } from '../../ui/components/blind-draft.js';
import {
  buildBlindDraftClosedEmbed,
  buildBlindDraftEmbed,
  buildBlindDraftRevealEmbed,
  buildBlindDraftTimeoutEmbed,
  buildBlindDraftTrackingEmbed,
} from '../../ui/embeds/blind-draft.js';
import { DraftError } from '../draft.service.js';
import { buildStandardDraftResult, runStandardDraftMode } from './standard.js';

const BLIND_MENU_PAGE_SIZE = 25;
const DM_CONCURRENCY = 8;

const activeBlindDrafts = new Map<string, BlindDraftSession>();

type RenderPayload = Omit<MessageCreateOptions, 'flags'> & Omit<MessageEditOptions, 'flags'>;

type BlindCustomId =
  | Readonly<{ action: 'pick'; pickType: 'civ' | 'leader'; sessionId: string }>
  | Readonly<{ action: 'nav'; pickType: 'civ' | 'leader'; navDir: 'prev' | 'next'; sessionId: string }>;

function parseBlindCustomId(customId: string): BlindCustomId | null {
  const pickMatch = /^gv:pick:(civ|leader):([A-Za-z0-9-]+)$/.exec(customId);
  if (pickMatch) {
    return { action: 'pick', pickType: pickMatch[1] as 'civ' | 'leader', sessionId: pickMatch[2] };
  }

  const navMatch = /^gv:nav:(civ|leader):(prev|next):([A-Za-z0-9-]+)$/.exec(customId);
  if (navMatch) {
    return {
      action: 'nav',
      pickType: navMatch[1] as 'civ' | 'leader',
      navDir: navMatch[2] as 'prev' | 'next',
      sessionId: navMatch[3],
    };
  }

  return null;
}

async function forEachLimit<T>(items: readonly T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  if (items.length === 0) return;
  const concurrency = Math.max(1, Math.min(limit, items.length));
  let next = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      try {
        await fn(items[index]);
      } catch {
        // best effort
      }
    }
  }

  await Promise.allSettled(Array.from({ length: concurrency }, () => worker()));
}

async function safeEditMessage(msg: Message, payload: RenderPayload): Promise<void> {
  try {
    if (!msg.editable) return;
    await msg.edit(payload);
  } catch {
    // best effort
  }
}

async function replyNotice(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
  content: string,
): Promise<void> {
  const base = { content, allowedMentions: { parse: [] as const } } as const;

  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(interaction.inGuild() ? { ...base, ephemeral: true } : base);
      return;
    }

    await interaction.reply(interaction.inGuild() ? { ...base, ephemeral: true } : base);
  } catch {
    // best effort
  }
}

function createBlindDraftLaunch(request: VoteDraftRequest) {
  try {
    const draft = buildStandardDraftResult({ ...request, draftMode: 'standard' });

    return {
      ok: true as const,
      assignments: request.voterIds.map((voterId, index) => {
        const group = draft.groups[index];
        return request.edition === 'CIV6'
          ? { voterId, leaders: group.leaders }
          : { voterId, leaders: group.leaders, civs: group.civs ?? [] };
      }),
    };
  } catch (err: unknown) {
    return {
      ok: false as const,
      message: err instanceof Error ? err.message : 'Blind draft setup failed.',
    };
  }
}

function getSession(sessionId: string): BlindDraftSession | null {
  return activeBlindDrafts.get(sessionId) ?? null;
}

function buildBlindDmPayload(session: BlindDraftSession, voterId: string): RenderPayload {
  const pools = session.pools.get(voterId);
  const currentState = session.pages.get(voterId) ?? { civPage: 0, leaderPage: 0 };

  if (!pools) {
    return {
      embeds: [buildBlindDraftEmbed({ edition: session.edition, pick: session.picks.get(voterId), endsAtMs: session.endsAtMs })],
      components: [],
      allowedMentions: { parse: [] as const },
    };
  }

  const state = clampBlindDraftPageState({ edition: session.edition, pools, state: currentState });
  if (state.civPage !== currentState.civPage || state.leaderPage !== currentState.leaderPage) {
    session.pages.set(voterId, state);
  }

  return {
    embeds: [
      buildBlindDraftEmbed({
        edition: session.edition,
        pick: session.picks.get(voterId),
        endsAtMs: session.endsAtMs,
      }),
    ],
    components: buildBlindDraftPickComponents({
      edition: session.edition,
      sessionId: session.sessionId,
      pools,
      state,
    }),
    allowedMentions: { parse: [] as const },
  };
}

function buildClosedDmPayload(
  session: BlindDraftSession,
  voterId: string,
  reason: 'timeout' | 'complete',
): RenderPayload {
  return {
    embeds: [
      buildBlindDraftClosedEmbed({
        edition: session.edition,
        pick: session.picks.get(voterId),
        reason,
      }),
    ],
    components: [],
    allowedMentions: { parse: [] as const },
  };
}

function isBlindComplete(session: BlindDraftSession): boolean {
  return session.voterIds.every((id) => {
    const pick = session.picks.get(id);
    if (!pick?.leaderKey) return false;
    if (session.edition === 'CIV7') return Boolean(pick.civKey);
    return true;
  });
}

async function updateTrackingMessage(session: BlindDraftSession): Promise<void> {
  const payload: RenderPayload = {
    embeds: [
      buildBlindDraftTrackingEmbed({
        edition: session.edition,
        voterIds: session.voterIds,
        picks: session.picks,
        endsAtMs: session.endsAtMs,
      }),
    ],
    allowedMentions: { parse: [] as const },
  };

  if (!session.trackingMessage) {
    try {
      session.trackingMessage = await session.commandChannel.send(payload);
    } catch {
      session.trackingMessage = null;
    }
    return;
  }

  await safeEditMessage(session.trackingMessage, payload);
}

async function finalizeBlindDraftSession(session: BlindDraftSession, reason: 'timeout' | 'complete'): Promise<void> {
  const active = activeBlindDrafts.get(session.sessionId);
  if (!active) return;

  if (session.timeout) {
    clearTimeout(session.timeout);
    session.timeout = null;
  }

  const trackingPayload: RenderPayload = {
    embeds: [
      reason === 'complete'
        ? buildBlindDraftRevealEmbed({
            edition: session.edition,
            voterIds: session.voterIds,
            picks: session.picks,
          })
        : buildBlindDraftTimeoutEmbed({
            edition: session.edition,
            voterIds: session.voterIds,
            picks: session.picks,
          }),
    ],
    allowedMentions: { parse: [] as const },
  };

  if (session.trackingMessage) {
    await safeEditMessage(session.trackingMessage, trackingPayload);
  } else {
    try {
      session.trackingMessage = await session.commandChannel.send(trackingPayload);
    } catch {
      // best effort
    }
  }

  await forEachLimit([...session.dmMessages.entries()], DM_CONCURRENCY, async ([voterId, message]) => {
    await safeEditMessage(message, buildClosedDmPayload(session, voterId, reason));
  });

  activeBlindDrafts.delete(session.sessionId);
}

async function startBlindDraftSession(
  request: VoteDraftRequest,
  assignments: readonly BlindDraftAssignment[],
): Promise<void> {
  const session: BlindDraftSession = {
    sessionId: randomUUID(),
    edition: request.edition,
    voterIds: request.voterIds,
    commandChannel: request.commandChannel,
    voterUsersById: request.voterUsersById ?? new Map(),
    voteMessage: request.publicMessage,
    trackingMessage: null,
    dmMessages: new Map(),
    endsAtMs: Date.now() + DRAFT_TIMERS_MS.blind,
    timeout: null,
    pools: new Map(),
    picks: new Map(),
    pages: new Map(),
  };

  for (const assignment of assignments) {
    session.pools.set(
      assignment.voterId,
      request.edition === 'CIV6'
        ? { leaders: assignment.leaders }
        : { leaders: assignment.leaders, civs: assignment.civs ?? [] },
    );
    session.pages.set(assignment.voterId, { civPage: 0, leaderPage: 0 });
  }

  activeBlindDrafts.set(session.sessionId, session);
  await updateTrackingMessage(session);

  await forEachLimit(request.voterIds, DM_CONCURRENCY, async (voterId) => {
    const user = session.voterUsersById.get(voterId);
    if (!user) return;

    try {
      const message = await user.send(buildBlindDmPayload(session, voterId));
      session.dmMessages.set(voterId, message);
    } catch (err) {
      console.info('[blind-draft] dm send failed', { voterId, err });
    }
  });

  session.timeout = setTimeout(() => {
    void finalizeBlindDraftSession(session, 'timeout');
  }, DRAFT_TIMERS_MS.blind);
}

function fallbackToStandardPayload(request: VoteDraftRequest, message: string): Promise<DraftModeOutput> {
  return runStandardDraftMode({ ...request, draftMode: 'standard' }).then((payload) => ({
    ...payload,
    content: `${EMOJI_ERROR} ${message}\nFalling back to standard draft.`,
  }));
}

export async function runBlindDraftMode(request: VoteDraftRequest): Promise<DraftModeOutput | null> {
  if (request.source !== 'vote') {
    throw new DraftError('VALIDATION', 'Blind draft is only available from the vote flow.');
  }

  if (!request.voterUsersById || request.voterUsersById.size === 0) {
    return fallbackToStandardPayload(request, 'Blind draft requires voter DM context.');
  }

  const launch = createBlindDraftLaunch(request);
  if (!launch.ok) {
    return fallbackToStandardPayload(request, launch.message);
  }

  await startBlindDraftSession(request, launch.assignments);
  return null;
}

export async function handleBlindDraftSelect(interaction: StringSelectMenuInteraction): Promise<boolean> {
  const parsed = parseBlindCustomId(interaction.customId);
  if (!parsed || parsed.action !== 'pick') return false;

  const session = getSession(parsed.sessionId);
  if (!session) {
    await replyNotice(interaction, '⚠️ Blind draft is not active.');
    return true;
  }

  const userId = interaction.user.id;
  if (!session.voterIds.includes(userId)) {
    await replyNotice(interaction, '⚠️ You are not part of this blind draft.');
    return true;
  }

  const pickId = interaction.values[0];
  const pick = session.picks.get(userId) ?? {};
  if (parsed.pickType === 'civ') pick.civKey = pickId;
  if (parsed.pickType === 'leader') pick.leaderKey = pickId;
  session.picks.set(userId, pick);

  await interaction.update(buildBlindDmPayload(session, userId));
  await updateTrackingMessage(session);

  if (isBlindComplete(session)) {
    await finalizeBlindDraftSession(session, 'complete');
  }
  return true;
}

export async function handleBlindDraftButton(interaction: ButtonInteraction): Promise<boolean> {
  const parsed = parseBlindCustomId(interaction.customId);
  if (!parsed || parsed.action !== 'nav') return false;

  const session = getSession(parsed.sessionId);
  if (!session) {
    await replyNotice(interaction, '⚠️ Blind draft is not active.');
    return true;
  }

  const userId = interaction.user.id;
  if (!session.voterIds.includes(userId)) {
    await replyNotice(interaction, '⚠️ You are not part of this blind draft.');
    return true;
  }

  const pages: BlindDraftPageState = session.pages.get(userId) ?? { civPage: 0, leaderPage: 0 };
  const pools = session.pools.get(userId);
  if (!pools) {
    await replyNotice(interaction, '⚠️ Blind draft options are unavailable.');
    return true;
  }

  const pageKey = parsed.pickType === 'civ' ? 'civPage' : 'leaderPage';
  const maxPage = parsed.pickType === 'civ'
    ? Math.max(0, Math.ceil((pools.civs?.length ?? 0) / BLIND_MENU_PAGE_SIZE) - 1)
    : Math.max(0, Math.ceil(pools.leaders.length / BLIND_MENU_PAGE_SIZE) - 1);

  const currentPage = pageKey === 'civPage' ? pages.civPage : pages.leaderPage;
  const nextPage = parsed.navDir === 'next' ? currentPage + 1 : currentPage - 1;
  const page = Math.max(0, Math.min(maxPage, nextPage));
  const nextState = pageKey === 'civPage' ? { ...pages, civPage: page } : { ...pages, leaderPage: page };
  session.pages.set(userId, nextState);

  await interaction.update(buildBlindDmPayload(session, userId));
  return true;
}
