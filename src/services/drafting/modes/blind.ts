import { randomUUID } from 'node:crypto';

import type {
  ButtonInteraction,
  Message,
  StringSelectMenuInteraction,
} from 'discord.js';

import { EMOJI_ERROR } from '../../../config/constants.js';
import type { VoteDraftRequest } from '../../../types/drafting.types.js';
import type {
  BlindDraftAssignment,
  BlindDraftPageState,
  BlindDraftSession,
  DraftModeOutput,
} from '../../../types/drafting.types.js';
import { buildBlindDraftPickComponents, clampBlindDraftPageState } from '../../../ui/components/blind-draft.js';
import {
  type DraftRenderPayload,
  replyDraftNotice,
  safeEditDraftMessage,
  upsertDraftTrackingMessage,
} from '../runtime/message-ops.service.js';
import { clampPageIndex } from '../runtime/pagination.service.js';
import {
  closeInteractiveDraftSession,
  requireActiveInteractiveDraftSession,
  scheduleInteractiveSessionTimeout,
} from '../runtime/session-runtime.service.js';
import { applyStagedPickSelection, isBlindDraftSubmissionReady } from '../runtime/staged-pick.service.js';
import {
  buildBlindDraftClosedEmbed,
  buildBlindDraftEmbed,
  buildBlindDraftRevealEmbed,
  buildBlindDraftTimeoutEmbed,
  buildBlindDraftTrackingEmbed,
} from '../../../ui/embeds/blind-draft.js';
import { buildVoteStandardDraftResult, DraftError } from '../draft.service.js';

const BLIND_DRAFT_DURATION_MS = 10 * 60_000;
const BLIND_MENU_PAGE_SIZE = 25;
const DM_CONCURRENCY = 8;

const activeBlindDrafts = new Map<string, BlindDraftSession>();

type BlindCustomId =
  | Readonly<{ action: 'pick'; pickType: 'civ' | 'leader'; sessionId: string }>
  | Readonly<{ action: 'nav'; pickType: 'civ' | 'leader'; navDir: 'prev' | 'next'; sessionId: string }>
  | Readonly<{ action: 'submit'; sessionId: string }>;

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

  const submitMatch = /^gv:submit:([A-Za-z0-9-]+)$/.exec(customId);
  if (submitMatch) {
    return { action: 'submit', sessionId: submitMatch[1] };
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

function createBlindDraftLaunch(request: VoteDraftRequest) {
  try {
    const draft = buildVoteStandardDraftResult({ ...request, draftMode: 'standard' });

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

function buildBlindDmPayload(session: BlindDraftSession, voterId: string): DraftRenderPayload {
  const pools = session.pools.get(voterId);
  const currentState = session.pages.get(voterId) ?? { civPage: 0, leaderPage: 0 };

  if (!pools) {
    return {
      embeds: [buildBlindDraftEmbed({ edition: session.edition, pick: session.picks.get(voterId), endsAtMs: session.endsAtMs, voteUuid: session.voteUuid })],
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
        stagedPick: session.stagedPicks.get(voterId),
        endsAtMs: session.endsAtMs,
        voteUuid: session.voteUuid,
      }),
    ],
    components: buildBlindDraftPickComponents({
      edition: session.edition,
      sessionId: session.sessionId,
      pools,
      state,
      pick: session.picks.get(voterId),
      stagedPick: session.stagedPicks.get(voterId),
    }),
    allowedMentions: { parse: [] as const },
  };
}

function buildClosedDmPayload(
  session: BlindDraftSession,
  voterId: string,
  reason: 'timeout' | 'complete',
): DraftRenderPayload {
  return {
    embeds: [
      buildBlindDraftClosedEmbed({
        edition: session.edition,
        pick: session.picks.get(voterId),
        reason,
        voteUuid: session.voteUuid,
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
  const payload: DraftRenderPayload = {
    embeds: [
      buildBlindDraftTrackingEmbed({
        edition: session.edition,
        voterIds: session.voterIds,
        picks: session.picks,
        stagedPicks: session.stagedPicks,
        endsAtMs: session.endsAtMs,
        voteUuid: session.voteUuid,
      }),
    ],
    allowedMentions: { parse: [] as const },
  };

  try {
    session.trackingMessage = await upsertDraftTrackingMessage(
      session.trackingMessage,
      payload,
      () => session.commandChannel.send(payload),
    );
  } catch {
    session.trackingMessage = null;
  }
}

async function finalizeBlindDraftSession(session: BlindDraftSession, reason: 'timeout' | 'complete'): Promise<void> {
  const trackingPayload: DraftRenderPayload = {
    embeds: [
      reason === 'complete'
        ? buildBlindDraftRevealEmbed({
            edition: session.edition,
            voterIds: session.voterIds,
            picks: session.picks,
            voteUuid: session.voteUuid,
          })
        : buildBlindDraftTimeoutEmbed({
            edition: session.edition,
            voterIds: session.voterIds,
            picks: session.picks,
            voteUuid: session.voteUuid,
          }),
    ],
    allowedMentions: { parse: [] as const },
  };

  if (session.trackingMessage) {
    await safeEditDraftMessage(session.trackingMessage, trackingPayload);
  } else {
    try {
      session.trackingMessage = await session.commandChannel.send(trackingPayload);
    } catch {
      // best effort
    }
  }

  await closeInteractiveDraftSession(activeBlindDrafts, session, async () => {
    await forEachLimit([...session.dmMessages.entries()], DM_CONCURRENCY, async ([voterId, message]) => {
      await safeEditDraftMessage(message, buildClosedDmPayload(session, voterId, reason));
    });
  });
}

async function failSentBlindDmMessages(messages: readonly Message<false>[]): Promise<void> {
  for (const message of messages) {
    await safeEditDraftMessage(message, {
      content: `${EMOJI_ERROR} Blind draft could not start because I could not DM every voter. Please enable DMs and try again.`,
      embeds: [],
      components: [],
      allowedMentions: { parse: [] as const },
    });
  }
}

async function startBlindDraftSession(
  request: VoteDraftRequest,
  assignments: readonly BlindDraftAssignment[],
): Promise<void> {
  const voterUsersById = request.voterUsersById;
  if (!voterUsersById) {
    throw new DraftError('VALIDATION', 'Blind draft requires DM access for every voter.');
  }

  const session: BlindDraftSession = {
    sessionId: randomUUID(),
    edition: request.edition,
    voterIds: request.voterIds,
    commandChannel: request.commandChannel,
    voterUsersById,
    voteMessage: request.publicMessage,
    trackingMessage: null,
    dmMessages: new Map(),
    endsAtMs: Date.now() + BLIND_DRAFT_DURATION_MS,
    timeout: null,
    pools: new Map(),
    picks: new Map(),
    stagedPicks: new Map(),
    pages: new Map(),
    voteUuid: request.voteUuid,
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

  const dmMessages: Message<false>[] = [];
  for (const voterId of request.voterIds) {
    const user = session.voterUsersById.get(voterId);
    if (!user) {
      throw new DraftError('VALIDATION', 'Blind draft requires DM access for every voter.');
    }

    try {
      const message = await user.send(buildBlindDmPayload(session, voterId));
      session.dmMessages.set(voterId, message);
      dmMessages.push(message);
    } catch (err) {
      console.info('[blind-draft] dm send failed', { voterId, err });
      await failSentBlindDmMessages(dmMessages);
      throw new DraftError('VALIDATION', 'Blind draft could not start because I could not DM every voter. Please enable DMs and try again.');
    }
  }

  activeBlindDrafts.set(session.sessionId, session);
  await updateTrackingMessage(session);

  scheduleInteractiveSessionTimeout(session, BLIND_DRAFT_DURATION_MS, () => {
    void finalizeBlindDraftSession(session, 'timeout');
  });
}

export async function runBlindDraftMode(request: VoteDraftRequest): Promise<DraftModeOutput | null> {
  if (request.source !== 'vote') {
    throw new DraftError('VALIDATION', 'Blind draft is only available from the vote flow.');
  }

  if (!request.voterUsersById || request.voterUsersById.size !== request.voterIds.length) {
    throw new DraftError('VALIDATION', 'Blind draft requires DM access for every voter.');
  }

  const launch = createBlindDraftLaunch(request);
  if (!launch.ok) {
    throw new DraftError('VALIDATION', launch.message);
  }

  await startBlindDraftSession(request, launch.assignments);
  return null;
}

export async function handleBlindDraftSelect(interaction: StringSelectMenuInteraction): Promise<boolean> {
  const parsed = parseBlindCustomId(interaction.customId);
  if (!parsed || parsed.action !== 'pick') return false;

  const session = await requireActiveInteractiveDraftSession(
    interaction,
    activeBlindDrafts,
    parsed.sessionId,
    '⚠️ Blind draft is not active.',
  );
  if (!session) return true;

  const userId = interaction.user.id;
  if (!session.voterIds.includes(userId)) {
    await replyDraftNotice(interaction, '⚠️ You are not part of this blind draft.');
    return true;
  }

  const pools = session.pools.get(userId);
  if (!pools) {
    await replyDraftNotice(interaction, '⚠️ Blind draft options are unavailable.');
    return true;
  }

  const pickId = interaction.values[0];
  const allowed = parsed.pickType === 'civ'
    ? (pools.civs ?? []).includes(pickId)
    : pools.leaders.includes(pickId);

  if (!allowed) {
    await replyDraftNotice(interaction, '⚠️ That choice is not available in your blind draft pool.');
    return true;
  }

  const pick = applyStagedPickSelection(session.stagedPicks.get(userId) ?? session.picks.get(userId), parsed.pickType, pickId);
  session.stagedPicks.set(userId, pick);

  await interaction.update(buildBlindDmPayload(session, userId));
  await updateTrackingMessage(session);
  return true;
}

export async function handleBlindDraftButton(interaction: ButtonInteraction): Promise<boolean> {
  const parsed = parseBlindCustomId(interaction.customId);
  if (!parsed) return false;

  const session = await requireActiveInteractiveDraftSession(
    interaction,
    activeBlindDrafts,
    parsed.sessionId,
    '⚠️ Blind draft is not active.',
  );
  if (!session) return true;

  const userId = interaction.user.id;
  if (!session.voterIds.includes(userId)) {
    await replyDraftNotice(interaction, '⚠️ You are not part of this blind draft.');
    return true;
  }

  const pages: BlindDraftPageState = session.pages.get(userId) ?? { civPage: 0, leaderPage: 0 };
  const pools = session.pools.get(userId);
  if (!pools) {
    await replyDraftNotice(interaction, '⚠️ Blind draft options are unavailable.');
    return true;
  }

  if (parsed.action === 'submit') {
    const staged = session.stagedPicks.get(userId) ?? session.picks.get(userId);
    if (!isBlindDraftSubmissionReady(session.edition, staged) || !staged?.leaderKey) {
      await replyDraftNotice(interaction, '⚠️ Pick all required options before submitting.');
      return true;
    }

    if (!pools.leaders.includes(staged.leaderKey) || (session.edition === 'CIV7' && (!staged.civKey || !(pools.civs ?? []).includes(staged.civKey)))) {
      await replyDraftNotice(interaction, '⚠️ That choice is not available in your blind draft pool.');
      return true;
    }

    session.picks.set(userId, { ...staged });
    await interaction.update(buildBlindDmPayload(session, userId));
    await updateTrackingMessage(session);

    if (isBlindComplete(session)) {
      await finalizeBlindDraftSession(session, 'complete');
    }
    return true;
  }

  if (parsed.action !== 'nav') return false;

  const pageKey = parsed.pickType === 'civ' ? 'civPage' : 'leaderPage';
  const totalItems = parsed.pickType === 'civ' ? (pools.civs?.length ?? 0) : pools.leaders.length;
  const currentPage = pageKey === 'civPage' ? pages.civPage : pages.leaderPage;
  const nextPage = parsed.navDir === 'next' ? currentPage + 1 : currentPage - 1;
  const page = clampPageIndex(nextPage, totalItems, BLIND_MENU_PAGE_SIZE);
  const nextState = pageKey === 'civPage' ? { ...pages, civPage: page } : { ...pages, leaderPage: page };
  session.pages.set(userId, nextState);

  await interaction.update(buildBlindDmPayload(session, userId));
  return true;
}
