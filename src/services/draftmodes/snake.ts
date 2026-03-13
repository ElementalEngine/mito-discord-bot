import { randomInt, randomUUID } from 'node:crypto';

import type {
  ButtonInteraction,
  Message,
  MessageCreateOptions,
  MessageEditOptions,
  StringSelectMenuInteraction
} from 'discord.js';

import { DRAFT_TIMERS_MS } from '../../config/draft.config.js';
import { EMOJI_ERROR, EMOJI_RANDOM } from '../../config/constants.js';
import { CIV6_LEADERS } from '../../data/civ6.data.js';
import { CIV7_CIVS, CIV7_LEADERS } from '../../data/civ7.data.js';
import type { VoteDraftRequest } from '../../types/draft.types.js';
import type {
  DraftModeOutput,
  SnakeDraftPageState,
  SnakeDraftSession,
} from '../../types/drafting.types.js';
import { buildSnakeDraftPickComponents } from '../../ui/components/snake-draft.js';
import {
  buildSnakeDraftActiveDmEmbed,
  buildSnakeDraftCompleteEmbed,
  buildSnakeDraftStatusEmbed,
  buildSnakeDraftWaitingDmEmbed,
} from '../../ui/embeds/snake-draft.js';
import { DraftError } from '../draft.service.js';

const SNAKE_MENU_PAGE_SIZE = 25;
const activeSnakeDrafts = new Map<string, SnakeDraftSession>();

type RenderPayload = Omit<MessageCreateOptions, 'flags'> & Omit<MessageEditOptions, 'flags'>;

type SnakeCustomId =
  | Readonly<{ action: 'pick'; pickType: 'leader' | 'civ'; sessionId: string; turnToken: number }>
  | Readonly<{ action: 'nav'; pickType: 'leader' | 'civ'; navDir: 'prev' | 'next'; sessionId: string; turnToken: number }>
  | Readonly<{ action: 'submit'; sessionId: string; turnToken: number }> ;

function parseSnakeCustomId(customId: string): SnakeCustomId | null {
  const pick = /^sd:pick:(leader|civ):([A-Za-z0-9-]+):(\d+)$/.exec(customId);
  if (pick) {
    return {
      action: 'pick',
      pickType: pick[1] as 'leader' | 'civ',
      sessionId: pick[2],
      turnToken: Number.parseInt(pick[3], 10),
    };
  }

  const nav = /^sd:nav:(leader|civ):(prev|next):([A-Za-z0-9-]+):(\d+)$/.exec(customId);
  if (nav) {
    return {
      action: 'nav',
      pickType: nav[1] as 'leader' | 'civ',
      navDir: nav[2] as 'prev' | 'next',
      sessionId: nav[3],
      turnToken: Number.parseInt(nav[4], 10),
    };
  }

  const submit = /^sd:submit:([A-Za-z0-9-]+):(\d+)$/.exec(customId);
  if (submit) {
    return {
      action: 'submit',
      sessionId: submit[1],
      turnToken: Number.parseInt(submit[2], 10),
    };
  }

  return null;
}

function shuffle<T>(items: readonly T[]): T[] {
  const copy = items.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = randomInt(0, i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function pickRandom<T>(items: readonly T[]): T {
  return items[randomInt(0, items.length)];
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

function getLeaderPool(request: VoteDraftRequest): string[] {
  const banned = new Set(request.bannedLeaderKeys);
  return request.edition === 'CIV6'
    ? Object.keys(CIV6_LEADERS).filter((key) => !banned.has(key))
    : Object.keys(CIV7_LEADERS).filter((key) => !banned.has(key));
}

function getCivPool(request: VoteDraftRequest): string[] {
  if (request.edition !== 'CIV7') return [];
  const banned = new Set(request.bannedCivKeys);
  const allowAllAges = request.startingAge === 'None';
  return Object.entries(CIV7_CIVS)
    .filter(([key, meta]) => !banned.has(key) && (allowAllAges || meta.agePool === request.startingAge))
    .map(([key]) => key);
}

function getCurrentOrder(session: SnakeDraftSession): readonly string[] {
  if (session.round === 'leader') return session.order;
  if (session.round === 'civ') return session.civOrder;
  return [];
}

function getCurrentPickerId(session: SnakeDraftSession): string | null {
  const order = getCurrentOrder(session);
  return order[session.turnIndex] ?? null;
}

function getAvailableLeaders(session: SnakeDraftSession): string[] {
  const used = new Set([...session.picks.values()].map((pick) => pick.leaderKey).filter(Boolean));
  return session.leaderPool.filter((key) => !used.has(key));
}

function getAvailableCivs(session: SnakeDraftSession): string[] {
  if (session.edition !== 'CIV7') return [];
  if (session.startingAge !== 'None') return [...session.civPool];
  const used = new Set([...session.picks.values()].map((pick) => pick.civKey).filter(Boolean));
  return session.civPool.filter((key) => !used.has(key));
}

function isUserCurrentPicker(session: SnakeDraftSession, userId: string): boolean {
  return getCurrentPickerId(session) === userId;
}

function getUserPages(session: SnakeDraftSession, userId: string): SnakeDraftPageState {
  return session.pages.get(userId) ?? { leaderPage: 0, civPage: 0 };
}

function buildWaitingPayload(session: SnakeDraftSession, userId: string): RenderPayload {
  return {
    embeds: [buildSnakeDraftWaitingDmEmbed({
      edition: session.edition,
      round: session.round,
      currentPickerId: getCurrentPickerId(session),
      pick: session.picks.get(userId),
      voteUuid: session.voteUuid,
    })],
    components: [],
  };
}

function buildActivePayload(session: SnakeDraftSession, userId: string): RenderPayload {
  const state = getUserPages(session, userId);
  const round = session.round === 'complete' ? 'leader' : session.round;
  return {
    embeds: [buildSnakeDraftActiveDmEmbed({
      edition: session.edition,
      round,
      endsAtMs: session.turnEndsAtMs,
      pick: session.picks.get(userId),
      stagedPick: session.stagedPicks.get(userId),
      voteUuid: session.voteUuid,
    })],
    components: buildSnakeDraftPickComponents({
      edition: session.edition,
      round,
      sessionId: session.sessionId,
      turnToken: session.turnToken,
      state,
      leaders: round === 'leader' ? getAvailableLeaders(session) : undefined,
      civs: round === 'civ' ? getAvailableCivs(session) : undefined,
      pick: session.picks.get(userId),
      stagedPick: session.stagedPicks.get(userId),
    }),
  };
}

async function updateTrackingMessage(session: SnakeDraftSession): Promise<void> {
  const currentPickerId = getCurrentPickerId(session);
  const order = getCurrentOrder(session);
  const payload: RenderPayload = session.round === 'complete'
    ? {
        embeds: [buildSnakeDraftCompleteEmbed({
          edition: session.edition,
          order: session.order,
          picks: session.picks,
          lastEvent: session.lastEvent,
          voteUuid: session.voteUuid,
        })],
        allowedMentions: { parse: [] as const },
      }
    : {
        embeds: [buildSnakeDraftStatusEmbed({
          edition: session.edition,
          round: session.round,
          order,
          currentPickerId: currentPickerId!,
          picks: session.picks,
          endsAtMs: session.turnEndsAtMs,
          lastEvent: session.lastEvent,
          voteUuid: session.voteUuid,
        })],
        allowedMentions: { parse: [] as const },
      };

  if (session.trackingMessage) {
    await safeEditMessage(session.trackingMessage, payload);
  } else {
    session.trackingMessage = await session.commandChannel.send(payload);
  }
}

async function updateTurnDmMessages(session: SnakeDraftSession, previousPickerId?: string | null): Promise<void> {
  if (previousPickerId) {
    const prev = session.dmMessages.get(previousPickerId);
    if (prev) await safeEditMessage(prev, buildWaitingPayload(session, previousPickerId));
  }

  const currentPickerId = getCurrentPickerId(session);
  if (!currentPickerId) return;
  const current = session.dmMessages.get(currentPickerId);
  if (current) await safeEditMessage(current, buildActivePayload(session, currentPickerId));
}

async function finalizeSnakeDraftSession(session: SnakeDraftSession): Promise<void> {
  if (session.timeout) {
    clearTimeout(session.timeout);
    session.timeout = null;
  }
  session.round = 'complete';
  await updateTrackingMessage(session);
  for (const [userId, message] of session.dmMessages.entries()) {
    await safeEditMessage(message, buildWaitingPayload(session, userId));
  }
  activeSnakeDrafts.delete(session.sessionId);
}

async function scheduleNextTurn(session: SnakeDraftSession, previousPickerId?: string | null): Promise<void> {
  if (session.timeout) {
    clearTimeout(session.timeout);
    session.timeout = null;
  }

  if (session.round === 'complete') {
    await finalizeSnakeDraftSession(session);
    return;
  }

  session.turnToken += 1;
  session.turnEndsAtMs = Date.now() + DRAFT_TIMERS_MS.snakePick;
  await updateTrackingMessage(session);
  await updateTurnDmMessages(session, previousPickerId);

  session.timeout = setTimeout(() => {
    void handleSnakeTimeout(session);
  }, DRAFT_TIMERS_MS.snakePick);
}

function advanceTurn(session: SnakeDraftSession): void {
  const order = getCurrentOrder(session);
  if (session.turnIndex + 1 < order.length) {
    session.turnIndex += 1;
    return;
  }

  if (session.edition === 'CIV7' && session.round === 'leader') {
    session.round = 'civ';
    session.turnIndex = 0;
    return;
  }

  session.round = 'complete';
}

async function applyPick(session: SnakeDraftSession, userId: string, key: string, auto: boolean): Promise<void> {
  const current = session.picks.get(userId);
  const pick: { leaderKey?: string; civKey?: string } = current ? { ...current } : {};
  const previousPickerId = userId;

  if (session.round === 'leader') {
    pick.leaderKey = key;
    session.lastEvent = auto ? `${EMOJI_RANDOM} ${session.voterUsersById.get(userId) ? `<@${userId}>` : userId} timed out — random leader assigned.` : undefined;
  } else if (session.round === 'civ') {
    pick.civKey = key;
    session.lastEvent = auto ? `${EMOJI_RANDOM} ${session.voterUsersById.get(userId) ? `<@${userId}>` : userId} timed out — random civ assigned.` : undefined;
  }

  session.picks.set(userId, pick);
  session.stagedPicks.delete(userId);
  advanceTurn(session);
  await scheduleNextTurn(session, previousPickerId);
}

async function handleSnakeTimeout(session: SnakeDraftSession): Promise<void> {
  if (session.round === 'complete') return;
  const userId = getCurrentPickerId(session);
  if (!userId) return;

  const available = session.round === 'leader' ? getAvailableLeaders(session) : getAvailableCivs(session);
  if (available.length === 0) {
    session.lastEvent = `${EMOJI_ERROR} Snake draft closed because no valid picks remained.`;
    session.round = 'complete';
    await finalizeSnakeDraftSession(session);
    return;
  }

  await applyPick(session, userId, pickRandom(available), true);
}

async function failSentDmMessages(messages: readonly Message<false>[]): Promise<void> {
  for (const message of messages) {
    await safeEditMessage(message, {
      content: `${EMOJI_ERROR} Snake draft could not start because I could not DM every voter. Please enable DMs and try again.`,
      embeds: [],
      components: [],
    });
  }
}

export async function runSnakeDraftMode(request: VoteDraftRequest): Promise<DraftModeOutput | null> {
  if (request.source !== 'vote') {
    throw new DraftError('VALIDATION', 'Snake draft is only available from the vote flow.');
  }
  if (request.gameType === 'Teamer') {
    throw new DraftError('VALIDATION', 'Snake draft is only available for FFA or Duel votes.');
  }
  if (!request.voterUsersById || request.voterUsersById.size !== request.voterIds.length) {
    throw new DraftError('VALIDATION', 'Snake draft requires DM access for every voter.');
  }

  const leaderPool = getLeaderPool(request);
  if (leaderPool.length < request.voterIds.length) {
    throw new DraftError('NO_POOL', 'Not enough leaders remain after bans for snake draft.');
  }

  const civPool = getCivPool(request);
  if (request.edition === 'CIV7') {
    if (request.startingAge === 'None' && civPool.length < request.voterIds.length) {
      throw new DraftError('NO_POOL', 'Not enough civs remain after bans for snake draft.');
    }
    if (civPool.length === 0) {
      throw new DraftError('NO_POOL', 'No civs remain after bans for snake draft.');
    }
  }

  const order = shuffle(request.voterIds);
  const sessionId = randomUUID();
  const session: SnakeDraftSession = {
    sessionId,
    edition: request.edition,
    startingAge: request.startingAge,
    voterIds: request.voterIds,
    order,
    civOrder: [...order].reverse(),
    commandChannel: request.commandChannel,
    voterUsersById: request.voterUsersById,
    trackingMessage: null,
    dmMessages: new Map(),
    leaderPool,
    civPool,
    picks: new Map(),
    stagedPicks: new Map(),
    pages: new Map(),
    round: 'leader',
    turnIndex: 0,
    turnToken: 0,
    turnEndsAtMs: 0,
    timeout: null,
    lastEvent: 'Initial order randomized.',
    voteUuid: request.voteUuid,
  };

  const dmMessages: Message<false>[] = [];
  const firstPickerId = getCurrentPickerId(session);
  for (const userId of request.voterIds) {
    const user = request.voterUsersById.get(userId);
    if (!user) {
      throw new DraftError('VALIDATION', 'Snake draft requires DM access for every voter.');
    }

    try {
      const payload = userId === firstPickerId
        ? buildActivePayload(session, userId)
        : buildWaitingPayload(session, userId);
      const message = await user.send(payload);
      session.dmMessages.set(userId, message);
      dmMessages.push(message);
    } catch {
      await failSentDmMessages(dmMessages);
      throw new DraftError('VALIDATION', 'Snake draft could not start because I could not DM every voter. Please enable DMs and try again.');
    }
  }

  activeSnakeDrafts.set(sessionId, session);
  await scheduleNextTurn(session, null);
  return null;
}

function getSnakeSession(sessionId: string): SnakeDraftSession | null {
  return activeSnakeDrafts.get(sessionId) ?? null;
}

export async function handleSnakeDraftSelect(interaction: StringSelectMenuInteraction): Promise<boolean> {
  const parsed = parseSnakeCustomId(interaction.customId);
  if (!parsed || parsed.action !== 'pick') return false;

  const session = getSnakeSession(parsed.sessionId);
  if (!session) {
    await replyNotice(interaction, '⚠️ Snake draft is not active.');
    return true;
  }
  if (parsed.turnToken !== session.turnToken) {
    await replyNotice(interaction, '⚠️ This pick prompt has expired.');
    return true;
  }
  const userId = interaction.user.id;
  if (!isUserCurrentPicker(session, userId)) {
    await replyNotice(interaction, '⚠️ It is not your turn to pick.');
    return true;
  }
  if (parsed.pickType !== session.round) {
    await replyNotice(interaction, '⚠️ That pick prompt is no longer active.');
    return true;
  }

  const choice = interaction.values[0];
  const available = parsed.pickType === 'leader' ? getAvailableLeaders(session) : getAvailableCivs(session);
  if (!available.includes(choice)) {
    await replyNotice(interaction, '⚠️ That choice is no longer available.');
    return true;
  }

  const staged = { ...(session.stagedPicks.get(userId) ?? session.picks.get(userId) ?? {}) };
  if (parsed.pickType === 'leader') staged.leaderKey = choice;
  if (parsed.pickType === 'civ') staged.civKey = choice;
  session.stagedPicks.set(userId, staged);

  await interaction.update(buildActivePayload(session, userId));
  return true;
}

export async function handleSnakeDraftButton(interaction: ButtonInteraction): Promise<boolean> {
  const parsed = parseSnakeCustomId(interaction.customId);
  if (!parsed) return false;

  const session = getSnakeSession(parsed.sessionId);
  if (!session) {
    await replyNotice(interaction, '⚠️ Snake draft is not active.');
    return true;
  }
  if (parsed.turnToken !== session.turnToken) {
    await replyNotice(interaction, '⚠️ This pick prompt has expired.');
    return true;
  }
  const userId = interaction.user.id;
  if (!isUserCurrentPicker(session, userId)) {
    await replyNotice(interaction, '⚠️ It is not your turn to pick.');
    return true;
  }

  if (parsed.action === 'submit') {
    const staged = session.stagedPicks.get(userId) ?? session.picks.get(userId);
    const key = session.round === 'leader' ? staged?.leaderKey : staged?.civKey;
    if (!key) {
      await replyNotice(interaction, '⚠️ Choose a pick before submitting.');
      return true;
    }

    const available = session.round === 'leader' ? getAvailableLeaders(session) : getAvailableCivs(session);
    if (!available.includes(key)) {
      await replyNotice(interaction, '⚠️ That choice is no longer available.');
      return true;
    }

    await interaction.deferUpdate();
    await applyPick(session, userId, key, false);
    return true;
  }

  if (parsed.action !== 'nav') return false;
  if (parsed.pickType !== session.round) {
    await replyNotice(interaction, '⚠️ That picker is no longer active.');
    return true;
  }

  const pages = getUserPages(session, userId);
  const pageKey = parsed.pickType === 'leader' ? 'leaderPage' : 'civPage';
  const totalPages = Math.max(1, Math.ceil((parsed.pickType === 'leader' ? getAvailableLeaders(session).length : getAvailableCivs(session).length) / SNAKE_MENU_PAGE_SIZE));
  const current = pages[pageKey];
  const next = parsed.navDir === 'next' ? current + 1 : current - 1;
  const page = Math.max(0, Math.min(totalPages - 1, next));
  const nextPages: SnakeDraftPageState = pageKey === 'leaderPage'
    ? { ...pages, leaderPage: page }
    : { ...pages, civPage: page };
  session.pages.set(userId, nextPages);
  await interaction.update(buildActivePayload(session, userId));
  return true;
}
