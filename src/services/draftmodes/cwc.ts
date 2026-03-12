import { randomInt, randomUUID } from 'node:crypto';

import type {
  ButtonInteraction,
  Message,
  MessageCreateOptions,
  MessageEditOptions,
  StringSelectMenuInteraction,
  User,
} from 'discord.js';

import { CWC_PICK_ORDER, DRAFT_TIMERS_MS } from '../../config/draft.config.js';
import { CIV6_LEADERS, lookupCiv6LeaderMeta } from '../../data/civ6.data.js';
import { CIV7_CIVS, CIV7_LEADERS, lookupCiv7CivMeta, lookupCiv7LeaderMeta } from '../../data/civ7.data.js';
import type { VoteDraftRequest } from '../../types/draft.types.js';
import type {
  CwcDraftPageState,
  CwcDraftSession,
  DraftModeOutput,
} from '../../types/drafting.types.js';
import { buildCwcCaptainSelectComponents, buildCwcPickComponents } from '../../ui/components/cwc-draft.js';
import {
  buildCwcCaptainSelectEmbed,
  buildCwcCaptainTimeoutEvent,
  buildCwcDraftCompleteEmbed,
  buildCwcDraftStatusEmbed,
  buildCwcTimeoutEvent,
} from '../../ui/embeds/cwc-draft.js';
import { DraftError } from '../draft.service.js';

const CWC_MENU_PAGE_SIZE = 25;
const activeCwcDrafts = new Map<string, CwcDraftSession>();

type RenderPayload = Omit<MessageCreateOptions, 'flags'> & Omit<MessageEditOptions, 'flags'>;

type CwcCustomId =
  | Readonly<{ action: 'captain'; teamIndex: 0 | 1; sessionId: string }>
  | Readonly<{ action: 'pick'; pickType: 'leader' | 'civ'; sessionId: string; turnToken: number }>
  | Readonly<{ action: 'nav'; pickType: 'leader' | 'civ'; navDir: 'prev' | 'next'; sessionId: string; turnToken: number }>;

function parseCwcCustomId(customId: string): CwcCustomId | null {
  const captain = /^cw:captain:(0|1):([A-Za-z0-9-]+)$/.exec(customId);
  if (captain) {
    return {
      action: 'captain',
      teamIndex: Number.parseInt(captain[1], 10) as 0 | 1,
      sessionId: captain[2],
    };
  }

  const pick = /^cw:pick:(leader|civ):([A-Za-z0-9-]+):(\d+)$/.exec(customId);
  if (pick) {
    return {
      action: 'pick',
      pickType: pick[1] as 'leader' | 'civ',
      sessionId: pick[2],
      turnToken: Number.parseInt(pick[3], 10),
    };
  }

  const nav = /^cw:nav:(leader|civ):(prev|next):([A-Za-z0-9-]+):(\d+)$/.exec(customId);
  if (nav) {
    return {
      action: 'nav',
      pickType: nav[1] as 'leader' | 'civ',
      navDir: nav[2] as 'prev' | 'next',
      sessionId: nav[3],
      turnToken: Number.parseInt(nav[4], 10),
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

function getSession(sessionId: string): CwcDraftSession | null {
  return activeCwcDrafts.get(sessionId) ?? null;
}

function getTeamSize(request: VoteDraftRequest): number {
  return Math.floor(request.voterIds.length / 2);
}

function getOrderForTeamSize(teamSize: number): number[] {
  return [...CWC_PICK_ORDER.slice(0, teamSize * 2)];
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

function buildLabelsById(voterIds: readonly string[], voterUsersById: ReadonlyMap<string, User>): ReadonlyMap<string, string> {
  const labels = new Map<string, string>();
  for (const id of voterIds) {
    const user = voterUsersById.get(id);
    labels.set(id, user?.username ?? id);
  }
  return labels;
}

function getCurrentTeamIndex(session: CwcDraftSession): 0 | 1 {
  return (session.pickOrder[session.turnIndex] ?? 0) as 0 | 1;
}

function getCurrentCaptainId(session: CwcDraftSession): string | null {
  if (session.round === 'captains' || session.round === 'complete') return null;
  return session.captainIds[getCurrentTeamIndex(session)];
}

function getAvailableLeaders(session: CwcDraftSession): string[] {
  const used = new Set([...session.picks[0].leaders, ...session.picks[1].leaders]);
  return session.leaderPool.filter((key) => !used.has(key));
}

function getAvailableCivs(session: CwcDraftSession): string[] {
  if (session.edition !== 'CIV7') return [];
  if (session.startingAge !== 'None') return [...session.civPool];
  const used = new Set([...session.picks[0].civs, ...session.picks[1].civs]);
  return session.civPool.filter((key) => !used.has(key));
}

function getUserPages(session: CwcDraftSession, userId: string): CwcDraftPageState {
  return session.pages.get(userId) ?? { leaderPage: 0, civPage: 0 };
}

function clampPage(current: number, totalItems: number): number {
  const maxPage = Math.max(0, Math.ceil(totalItems / CWC_MENU_PAGE_SIZE) - 1);
  return Math.max(0, Math.min(maxPage, current));
}

function buildCaptainPayload(session: CwcDraftSession): RenderPayload {
  return {
    embeds: [buildCwcCaptainSelectEmbed({
      edition: session.edition,
      startingAge: session.startingAge,
      hostId: session.hostId,
      teamSize: session.voterIds.length / 2,
      captainIds: session.captainIds,
      endsAtMs: session.turnEndsAtMs,
      lastEvent: session.lastEvent,
    })],
    components: buildCwcCaptainSelectComponents({
      sessionId: session.sessionId,
      teamCaptains: session.captainIds,
      voterIds: session.voterIds,
      labelsById: buildLabelsById(session.voterIds, session.voterUsersById),
    }),
    allowedMentions: { parse: [] as const },
  };
}

function buildDraftPayload(session: CwcDraftSession): RenderPayload {
  const currentCaptainId = getCurrentCaptainId(session);
  if (!currentCaptainId) {
    return {
      embeds: [buildCwcDraftCompleteEmbed(session)],
      components: [],
      allowedMentions: { parse: [] as const },
    };
  }

  const state = getUserPages(session, currentCaptainId);
  const nextState: CwcDraftPageState = session.round === 'leader'
    ? { ...state, leaderPage: clampPage(state.leaderPage, getAvailableLeaders(session).length) }
    : { ...state, civPage: clampPage(state.civPage, getAvailableCivs(session).length) };
  if (nextState.civPage !== state.civPage || nextState.leaderPage !== state.leaderPage) {
    session.pages.set(currentCaptainId, nextState);
  }

  return {
    embeds: [buildCwcDraftStatusEmbed(session)],
    components: buildCwcPickComponents({
      edition: session.edition,
      round: session.round as 'leader' | 'civ',
      sessionId: session.sessionId,
      turnToken: session.turnToken,
      state: nextState,
      leaders: session.round === 'leader' ? getAvailableLeaders(session) : undefined,
      civs: session.round === 'civ' ? getAvailableCivs(session) : undefined,
    }),
    allowedMentions: { parse: [] as const },
  };
}

async function updateTrackingMessage(session: CwcDraftSession): Promise<void> {
  const payload = session.round === 'captains'
    ? buildCaptainPayload(session)
    : session.round === 'complete'
      ? { embeds: [buildCwcDraftCompleteEmbed(session)], components: [], allowedMentions: { parse: [] as const } }
      : buildDraftPayload(session);

  if (session.trackingMessage) {
    await safeEditMessage(session.trackingMessage, payload);
  } else {
    session.trackingMessage = await session.commandChannel.send(payload);
  }
}

function advanceTurn(session: CwcDraftSession): void {
  if (session.turnIndex + 1 < session.pickOrder.length) {
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

async function finalizeSession(session: CwcDraftSession): Promise<void> {
  if (session.timeout) {
    clearTimeout(session.timeout);
    session.timeout = null;
  }
  session.round = 'complete';
  await updateTrackingMessage(session);
  activeCwcDrafts.delete(session.sessionId);
}

async function scheduleNextStep(session: CwcDraftSession): Promise<void> {
  if (session.timeout) {
    clearTimeout(session.timeout);
    session.timeout = null;
  }

  if (session.round === 'complete') {
    await finalizeSession(session);
    return;
  }

  session.turnToken += 1;
  session.turnEndsAtMs = Date.now() + (session.round === 'captains' ? DRAFT_TIMERS_MS.cwcCaptainSelect : DRAFT_TIMERS_MS.cwcPick);
  await updateTrackingMessage(session);

  session.timeout = setTimeout(() => {
    void handleCwcTimeout(session);
  }, session.round === 'captains' ? DRAFT_TIMERS_MS.cwcCaptainSelect : DRAFT_TIMERS_MS.cwcPick);
}

async function startLeaderRound(session: CwcDraftSession): Promise<void> {
  session.round = 'leader';
  session.turnIndex = 0;
  await scheduleNextStep(session);
}

async function handleCaptainTimeout(session: CwcDraftSession): Promise<void> {
  const remaining = session.voterIds.filter((id) => !session.captainIds.includes(id));
  if (!session.captainIds[0]) {
    session.captainIds[0] = pickRandom(remaining);
  }
  const remainingAfterTeam1 = session.voterIds.filter((id) => id !== session.captainIds[0] && id !== session.captainIds[1]);
  if (!session.captainIds[1]) {
    session.captainIds[1] = pickRandom(remainingAfterTeam1);
  }
  session.lastEvent = buildCwcCaptainTimeoutEvent({ captainIds: session.captainIds });
  await startLeaderRound(session);
}

async function handlePickTimeout(session: CwcDraftSession): Promise<void> {
  const teamIndex = getCurrentTeamIndex(session);
  if (session.round === 'leader') {
    const available = getAvailableLeaders(session);
    if (available.length === 0) {
      await finalizeSession(session);
      return;
    }
    const key = pickRandom(available);
    session.picks[teamIndex].leaders.push(key);
    session.lastEvent = buildCwcTimeoutEvent(teamIndex, session.edition, 'leader', key);
  } else if (session.round === 'civ') {
    const available = getAvailableCivs(session);
    if (available.length === 0) {
      await finalizeSession(session);
      return;
    }
    const key = pickRandom(available);
    session.picks[teamIndex].civs.push(key);
    session.lastEvent = buildCwcTimeoutEvent(teamIndex, session.edition, 'civ', key);
  }

  advanceTurn(session);
  await scheduleNextStep(session);
}

async function handleCwcTimeout(session: CwcDraftSession): Promise<void> {
  if (session.round === 'captains') {
    await handleCaptainTimeout(session);
    return;
  }
  await handlePickTimeout(session);
}

function validateRequest(request: VoteDraftRequest): void {
  if (request.source !== 'vote') {
    throw new DraftError('VALIDATION', 'CWC is only available from the vote flow.');
  }
  if (request.gameType !== 'Teamer') {
    throw new DraftError('VALIDATION', 'CWC is only available for Teamer votes.');
  }
  if (request.numberTeams !== 2) {
    throw new DraftError('VALIDATION', 'CWC requires exactly 2 teams.');
  }
  if (request.voterIds.length < 4 || request.voterIds.length > 16 || request.voterIds.length % 2 !== 0) {
    throw new DraftError('VALIDATION', 'CWC requires an even player count from 4 to 16.');
  }

  const leaderPool = getLeaderPool(request);
  if (leaderPool.length < request.voterIds.length) {
    throw new DraftError('NO_POOL', 'Not enough leaders remain after bans for CWC.');
  }

  if (request.edition === 'CIV7') {
    const civPool = getCivPool(request);
    if (request.startingAge === 'None' && civPool.length < request.voterIds.length) {
      throw new DraftError('NO_POOL', 'Not enough civs remain after bans for CWC.');
    }
    if (civPool.length === 0) {
      throw new DraftError('NO_POOL', 'No civs remain after bans for CWC.');
    }
  }
}

function createSession(request: VoteDraftRequest): CwcDraftSession {
  const teamSize = getTeamSize(request);
  return {
    sessionId: randomUUID(),
    edition: request.edition,
    startingAge: request.startingAge,
    hostId: request.hostId,
    voterIds: request.voterIds,
    commandChannel: request.commandChannel,
    voterUsersById: request.voterUsersById ?? new Map(),
    trackingMessage: null,
    captainIds: [null, null],
    pages: new Map(),
    leaderPool: shuffle(getLeaderPool(request)),
    civPool: shuffle(getCivPool(request)),
    picks: [{ leaders: [], civs: [] }, { leaders: [], civs: [] }],
    pickOrder: getOrderForTeamSize(teamSize),
    round: 'captains',
    turnIndex: 0,
    turnToken: 0,
    turnEndsAtMs: Date.now() + DRAFT_TIMERS_MS.cwcCaptainSelect,
    timeout: null,
    voteUuid: request.voteUuid,
  };
}

export async function runCwcDraftMode(request: VoteDraftRequest): Promise<DraftModeOutput | null> {
  validateRequest(request);
  const session = createSession(request);
  activeCwcDrafts.set(session.sessionId, session);
  await updateTrackingMessage(session);
  session.timeout = setTimeout(() => {
    void handleCwcTimeout(session);
  }, DRAFT_TIMERS_MS.cwcCaptainSelect);
  return null;
}

export async function handleCwcDraftSelect(interaction: StringSelectMenuInteraction): Promise<boolean> {
  const parsed = parseCwcCustomId(interaction.customId);
  if (!parsed) return false;

  const session = getSession(parsed.sessionId);
  if (!session) {
    await replyNotice(interaction, '⚠️ CWC draft is not active.');
    return true;
  }

  if (parsed.action === 'captain') {
    if (interaction.user.id !== session.hostId) {
      await replyNotice(interaction, '⚠️ Only the vote host can select captains.');
      return true;
    }

    const pickedId = interaction.values[0];
    const otherIndex: 0 | 1 = parsed.teamIndex === 0 ? 1 : 0;
    if (session.captainIds[otherIndex] === pickedId) {
      await replyNotice(interaction, '⚠️ Team captains must be different users.');
      return true;
    }

    session.captainIds[parsed.teamIndex] = pickedId;
    session.lastEvent = `Team ${parsed.teamIndex + 1} captain selected: <@${pickedId}>`;

    if (session.captainIds[0] && session.captainIds[1]) {
      await interaction.deferUpdate();
      await startLeaderRound(session);
      return true;
    }

    await interaction.update(buildCaptainPayload(session));
    return true;
  }

  if (parsed.action !== 'pick') return false;

  if (session.round === 'captains' || session.round === 'complete') {
    await replyNotice(interaction, '⚠️ CWC draft is not currently accepting picks.');
    return true;
  }

  if (parsed.turnToken !== session.turnToken) {
    await replyNotice(interaction, '⚠️ That pick menu is stale.');
    return true;
  }

  const currentCaptainId = getCurrentCaptainId(session);
  if (!currentCaptainId || interaction.user.id !== currentCaptainId) {
    await replyNotice(interaction, '⚠️ It is not your turn to pick.');
    return true;
  }

  const pickedKey = interaction.values[0];
  const teamIndex = getCurrentTeamIndex(session);

  if (session.round === 'leader') {
    const available = getAvailableLeaders(session);
    if (!available.includes(pickedKey)) {
      await replyNotice(interaction, '⚠️ That leader is no longer available.');
      return true;
    }
    session.picks[teamIndex].leaders.push(pickedKey);
    const label = session.edition === 'CIV6'
      ? lookupCiv6LeaderMeta(pickedKey)?.gameId ?? pickedKey
      : lookupCiv7LeaderMeta(pickedKey)?.gameId ?? pickedKey;
    session.lastEvent = `Team ${teamIndex + 1} picked **${label}**`;
  } else {
    const available = getAvailableCivs(session);
    if (!available.includes(pickedKey)) {
      await replyNotice(interaction, '⚠️ That civ is no longer available.');
      return true;
    }
    session.picks[teamIndex].civs.push(pickedKey);
    const label = lookupCiv7CivMeta(pickedKey)?.gameId ?? pickedKey;
    session.lastEvent = `Team ${teamIndex + 1} picked **${label}**`;
  }

  advanceTurn(session);
  await interaction.deferUpdate();
  await scheduleNextStep(session);
  return true;
}

export async function handleCwcDraftButton(interaction: ButtonInteraction): Promise<boolean> {
  const parsed = parseCwcCustomId(interaction.customId);
  if (!parsed || parsed.action !== 'nav') return false;

  const session = getSession(parsed.sessionId);
  if (!session) {
    await replyNotice(interaction, '⚠️ CWC draft is not active.');
    return true;
  }

  if (session.round === 'captains' || session.round === 'complete') {
    await replyNotice(interaction, '⚠️ CWC draft is not currently accepting picks.');
    return true;
  }

  if (parsed.turnToken !== session.turnToken) {
    await replyNotice(interaction, '⚠️ That picker is stale.');
    return true;
  }

  const currentCaptainId = getCurrentCaptainId(session);
  if (!currentCaptainId || interaction.user.id !== currentCaptainId) {
    await replyNotice(interaction, '⚠️ It is not your turn to pick.');
    return true;
  }

  const state = getUserPages(session, currentCaptainId);
  const nextState: CwcDraftPageState = parsed.pickType === 'leader'
    ? {
        ...state,
        leaderPage: clampPage(
          state.leaderPage + (parsed.navDir === 'next' ? 1 : -1),
          getAvailableLeaders(session).length,
        ),
      }
    : {
        ...state,
        civPage: clampPage(
          state.civPage + (parsed.navDir === 'next' ? 1 : -1),
          getAvailableCivs(session).length,
        ),
      };

  session.pages.set(currentCaptainId, nextState);
  await interaction.update(buildDraftPayload(session));
  return true;
}
