import {
  EmbedBuilder,
  MessageFlags,
  type ButtonInteraction,
  type Guild,
  type ModalSubmitInteraction,
  type Message,
  type StringSelectMenuInteraction,
  type User,
} from 'discord.js';
import { randomUUID } from 'node:crypto';

import { getGameVoteBanLimits, getVoteDurationMs } from '../config/draft.config.js';
import { buildGameVoteConfig } from './voting/domain/questions.service.js';
import { getQuestionMaxSelections, encodeVoteSelections, pickRandomVoteValue } from './voting/domain/tally.service.js';
import { getDraftMode, ensureLockedAll } from './voting/domain/tiebreak.service.js';
import { majorityBans } from './voting/domain/bans.service.js';
import { areAllVotersFinished } from './voting/domain/progress.service.js';
import { executeVoteDraft } from './drafting/orchestration.service.js';
import { buildRenderPayload, type PublicVotePayload } from './voting/panels/public-message.service.js';
import { buildBallotPayload } from './voting/panels/vote-panel.service.js';
import { BAN_CIV_PAGE_SIZE, BAN_LEADER_PAGE_SIZE, buildBansPanelViewPayload, getCivBanSource, getLeaderBanSource, sortKeysByGameId } from './voting/panels/bans-panel.service.js';
import { getVoteSessionById, isVoteVoiceBusy, reserveVoteVoice, releaseReservedVoteVoice, registerActiveVoteSession, scheduleVoteSessionTimeout, clearVoteSessionTimeout, finalizeVoteSessionCleanup } from './voting/runtime/session-runtime.service.js';
import { ensureStagedVoteRecord, firstUnansweredQuestionIdInRecord, hasStagedVoteChanges, commitVoteRecord, nextBallotQuestionId } from './voting/runtime/vote-state.service.js';
import { ensureStagedBans, getBanPageState, setBanPageState, mergePagedBanSelection, hasStagedBanChanges } from './voting/runtime/bans-state.service.js';
import { replySafe, replyNotice, safeEditMessage, openInitialVoteMessages } from './voting/runtime/message-ops.service.js';
import type {
  GameVoteSession,
  GameVoteVoter,
  StartGameVoteOptions,
  StartGameVoteResult,
  BanSubmission,
} from '../types/voting.types.js';
import type { VoteDraftRequest } from '../types/drafting.types.js';

const COMPLETED_SESSION_RETENTION_MS = 15 * 60_000;

type RenderPayload = PublicVotePayload;

function getEmptyBans(): BanSubmission {
  return { leaderKeys: [], civKeys: [] };
}

function cloneBanSubmission(bans: BanSubmission): BanSubmission {
  return { leaderKeys: [...bans.leaderKeys], civKeys: [...bans.civKeys] };
}

function getBanLimits(v: GameVoteSession): Readonly<{ leader: number; civ: number }> {
  return getGameVoteBanLimits(v.edition, v.startingAge);
}

function normalizeBanSubmission(v: GameVoteSession, bans: BanSubmission): BanSubmission {
  const limits = getBanLimits(v);
  return {
    leaderKeys: dedupeStable(bans.leaderKeys).slice(0, limits.leader),
    civKeys: dedupeStable(bans.civKeys).slice(0, limits.civ),
  };
}


function dedupeStable(keys: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const key of keys) {
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

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

async function finalizeCompletedVote(v: GameVoteSession): Promise<void> {
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





type ParsedCustomId =
  | Readonly<{ action: 'ballot' | 'ballotv' | 'submitvote' | 'finishvote' | 'randomvote' | 'ban' | 'bansubmit'; sessionId: string }>
  | Readonly<{ action: 'ballotnav'; navDir: 'prev' | 'next'; sessionId: string }>
  | Readonly<{ action: 'pick'; pickType: 'civ' | 'leader'; sessionId: string }>
  | Readonly<{ action: 'nav'; pickType: 'civ' | 'leader'; navDir: 'prev' | 'next'; sessionId: string }>
  | Readonly<{ action: 'banpick'; banType: 'civ' | 'leader'; sessionId: string }>
  | Readonly<{ action: 'bannav'; banType: 'civ' | 'leader'; navDir: 'prev' | 'next'; sessionId: string }>;

function parseCustomId(id: string): ParsedCustomId | null {
  const parts = id.split(':');
  if (parts[0] !== 'gv') return null;

  const action = parts[1] as ParsedCustomId['action'];

  if (action === 'pick') {
    // gv:pick:civ|leader:<sessionId>
    const pickType = parts[2] as 'civ' | 'leader';
    const sessionId = parts[3];
    if (!sessionId || (pickType !== 'civ' && pickType !== 'leader')) return null;
    return { action: 'pick', pickType, sessionId };
  }

  if (action === 'nav') {
    // gv:nav:civ|leader:prev|next:<sessionId>
    const pickType = parts[2] as 'civ' | 'leader';
    const navDir = parts[3] as 'prev' | 'next';
    const sessionId = parts[4];
    if (!sessionId || (pickType !== 'civ' && pickType !== 'leader')) return null;
    if (navDir !== 'prev' && navDir !== 'next') return null;
    return { action: 'nav', pickType, navDir, sessionId };
  }

  if (action === 'banpick') {
    // gv:banpick:civ|leader:<sessionId>
    const banType = parts[2] as 'civ' | 'leader';
    const sessionId = parts[3];
    if (!sessionId || (banType !== 'civ' && banType !== 'leader')) return null;
    return { action: 'banpick', banType, sessionId };
  }

  if (action === 'bannav') {
    // gv:bannav:civ|leader:prev|next:<sessionId>
    const banType = parts[2] as 'civ' | 'leader';
    const navDir = parts[3] as 'prev' | 'next';
    const sessionId = parts[4];
    if (!sessionId || (banType !== 'civ' && banType !== 'leader')) return null;
    if (navDir !== 'prev' && navDir !== 'next') return null;
    return { action: 'bannav', banType, navDir, sessionId };
  }

  if (action === 'ballotnav') {
    const navDir = parts[2] as 'prev' | 'next';
    const sessionId = parts[3];
    if (!sessionId) return null;
    if (navDir !== 'prev' && navDir !== 'next') return null;
    return { action: 'ballotnav', navDir, sessionId };
  }

  // gv:<action>:<sessionId>
  const sessionId = parts[2];
  if (!sessionId) return null;

  if (
    action === 'ballot' ||
    action === 'ballotv' ||
    action === 'submitvote' ||
    action === 'finishvote' ||
    action === 'randomvote' ||
    action === 'ban' ||
    action === 'bansubmit'
  ) {
    return { action, sessionId };
  }

  return null;
}



function isVoter(v: GameVoteSession, userId: string): boolean {
  return v.voterIds.includes(userId);
}

export async function handleGameVoteSelect(interaction: StringSelectMenuInteraction): Promise<boolean> {
  const parsed = parseCustomId(interaction.customId);
  if (!parsed) return false;

  const v = getVoteSessionById(parsed.sessionId);
  if (!v) { await replyNotice(interaction, '⚠️ This vote session has ended or is invalid.'); return true; }

  const userId = interaction.user.id;

  if (parsed.action === 'banpick') {
    if (v.status !== 'in_progress' || v.phase !== 'voting') { await replyNotice(interaction, '⚠️ Bans are closed.'); return true; }
    if (!isVoter(v, userId)) { await replyNotice(interaction, '⚠️ You are not part of this vote session.'); return true; }
    if (v.finished.has(userId)) { await replyNotice(interaction, '⚠️ You already finished your vote.'); return true; }

    const cur = ensureStagedBans(v, userId);

    if (parsed.banType === 'leader') {
      const leaders = getLeaderBanSource(v);
      const leaderKeys = sortKeysByGameId(leaders);
      const page = getBanPageState(v, userId);
      const leaderSlice = leaderKeys.slice(
        page.leaderPage * BAN_LEADER_PAGE_SIZE,
        page.leaderPage * BAN_LEADER_PAGE_SIZE + BAN_LEADER_PAGE_SIZE
      );

      v.stagedBansByVoter.set(userId, normalizeBanSubmission(v, {
        leaderKeys: mergePagedBanSelection(cur.leaderKeys, leaderSlice, interaction.values),
        civKeys: cur.civKeys,
      }));
    } else {
      if (v.edition !== 'CIV7') { await replyNotice(interaction, '⚠️ Civ bans are not available for Civ6.'); return true; }
      const civs = getCivBanSource(v);
      if (!civs) { await replyNotice(interaction, '⚠️ Civ bans are not available right now.'); return true; }
      const civKeys = sortKeysByGameId(civs);
      const page = getBanPageState(v, userId);
      const civSlice = civKeys.slice(
        page.civPage * BAN_CIV_PAGE_SIZE,
        page.civPage * BAN_CIV_PAGE_SIZE + BAN_CIV_PAGE_SIZE
      );

      v.stagedBansByVoter.set(userId, normalizeBanSubmission(v, {
        leaderKeys: cur.leaderKeys,
        civKeys: mergePagedBanSelection(cur.civKeys, civSlice, interaction.values),
      }));
    }

    await interaction.deferUpdate();
    return true;
  }

  if (!interaction.inCachedGuild()) return true;
  if (parsed.action !== 'ballotv') return true;

  if (v.status !== 'in_progress' || v.phase !== 'voting') { await replyNotice(interaction, '⚠️ Voting has ended.'); return true; }
  if (!isVoter(v, userId)) { await replyNotice(interaction, '⚠️ You are not part of this vote session.'); return true; }
  if (v.finished.has(userId)) { await replyNotice(interaction, '⚠️ You already finished your vote.'); return true; }

  const stagedRecord = ensureStagedVoteRecord(v, userId);
  const activeFromState =
    v.activeQuestionByVoter.get(userId) ?? firstUnansweredQuestionIdInRecord(v, stagedRecord) ?? v.questions[0]?.id;

  if (!activeFromState) { await replyNotice(interaction, '⚠️ No questions available.'); return true; }

  const qid = activeFromState;
  const q = v.questions.find((qq) => qq.id === qid);
  if (!q) { await replyNotice(interaction, '⚠️ Invalid question context.'); return true; }

  const selectedIds = interaction.values;
  const maxSelections = getQuestionMaxSelections(q);
  if (selectedIds.length === 0 || selectedIds.length > maxSelections || !selectedIds.every((optId) => q.options.some((option) => option.id === optId))) {
    await replyNotice(interaction, '⚠️ Invalid option selection.');
    return true;
  }

  const nextStored = encodeVoteSelections(q, selectedIds);
  if (!nextStored) {
    await replyNotice(interaction, '⚠️ Invalid option selection.');
    return true;
  }

  const nextActive = nextBallotQuestionId(v, userId, qid);
  const prev = stagedRecord.get(qid);
  if (prev === nextStored && (v.activeQuestionByVoter.get(userId) ?? activeFromState) === nextActive) {
    await interaction.deferUpdate();
    return true;
  }

  stagedRecord.set(qid, nextStored);
  if (prev !== nextStored && v.voteSubmitted.has(userId)) {
    v.voteSubmitted.delete(userId);
  }

  v.activeQuestionByVoter.set(userId, nextActive);

  const active = v.activeQuestionByVoter.get(userId) ?? activeFromState;
  await interaction.update(buildBallotPayload({ session: v, voterId: userId, activeQuestionId: active, stagedRecord }));

  return true;
}



export async function handleGameVoteButton(interaction: ButtonInteraction): Promise<boolean> {
  const parsed = parseCustomId(interaction.customId);
  if (!parsed) return false;

  const v = getVoteSessionById(parsed.sessionId);
  if (!v) { await replyNotice(interaction, '⚠️ This vote session has ended or is invalid.'); return true; }

  const userId = interaction.user.id;

  if (parsed.action === 'ballot') {
    if (v.status !== 'in_progress' || v.phase !== 'voting') { await replyNotice(interaction, '⚠️ Voting has ended.'); return true; }
    if (!isVoter(v, userId)) { await replyNotice(interaction, '⚠️ You are not part of this vote session.'); return true; }
    if (v.finished.has(userId)) { await replyNotice(interaction, '⚠️ You already finished your vote.'); return true; }

    const active =
      v.activeQuestionByVoter.get(userId) ?? firstUnansweredQuestionIdInRecord(v, ensureStagedVoteRecord(v, userId)) ?? v.questions[0]?.id;

    if (!active) { await replyNotice(interaction, '⚠️ No questions available.'); return true; }

    v.activeQuestionByVoter.set(userId, active);

    await replySafe(interaction, {
      ...buildBallotPayload({ session: v, voterId: userId, activeQuestionId: active }),
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (parsed.action === 'ballotnav') {
    if (v.status !== 'in_progress' || v.phase !== 'voting') { await replyNotice(interaction, '⚠️ Voting has ended.'); return true; }
    if (!isVoter(v, userId)) { await replyNotice(interaction, '⚠️ You are not part of this vote session.'); return true; }
    if (v.finished.has(userId)) { await replyNotice(interaction, '⚠️ You already finished your vote.'); return true; }

    const currentId =
      v.activeQuestionByVoter.get(userId) ?? firstUnansweredQuestionIdInRecord(v, ensureStagedVoteRecord(v, userId)) ?? v.questions[0]?.id;
    if (!currentId) { await replyNotice(interaction, '⚠️ No questions available.'); return true; }

    const currentIndex = v.questions.findIndex((q) => q.id === currentId);
    const nextIndex = parsed.navDir === 'next' ? currentIndex + 1 : currentIndex - 1;
    const nextQuestion = v.questions[nextIndex];
    if (!nextQuestion) { await interaction.deferUpdate(); return true; }

    v.activeQuestionByVoter.set(userId, nextQuestion.id);
    await interaction.update(buildBallotPayload({ session: v, voterId: userId, activeQuestionId: nextQuestion.id }));
    return true;
  }

  if (parsed.action === 'submitvote') {
    if (v.status !== 'in_progress' || v.phase !== 'voting') { await replyNotice(interaction, '⚠️ Voting has ended.'); return true; }
    if (!isVoter(v, userId)) { await replyNotice(interaction, '⚠️ You are not part of this vote session.'); return true; }
    if (v.finished.has(userId)) { await replyNotice(interaction, '⚠️ You already finished your vote.'); return true; }

    const staged = ensureStagedVoteRecord(v, userId);
    const missing = firstUnansweredQuestionIdInRecord(v, staged);
    if (missing) { await replyNotice(interaction, '⚠️ Answer all questions before submitting your vote.'); return true; }
    if (!hasStagedVoteChanges(v, userId)) { await replyNotice(interaction, '⚠️ No new vote changes to submit.'); return true; }

    commitVoteRecord(v, userId, staged);

    v.voteSubmitted.add(userId);
    v.stagedVotesByVoter.set(userId, new Map(staged));
    await safeEditMessage(v.publicMessage, buildRenderPayload(v));

    const active =
      v.activeQuestionByVoter.get(userId) ?? firstUnansweredQuestionIdInRecord(v, staged) ?? v.questions[0]?.id;
    const payload = active
      ? buildBallotPayload({ session: v, voterId: userId, activeQuestionId: active, stagedRecord: staged })
      : { embeds: [new EmbedBuilder().setDescription('Vote submitted.')], components: [], allowedMentions: { parse: [] as const } };

    try {
      await interaction.update(payload);
    } catch {
      await replySafe(interaction, { ...payload, flags: MessageFlags.Ephemeral });
    }

    return true;
  }

  if (parsed.action === 'finishvote') {
    if (v.status !== 'in_progress' || v.phase !== 'voting') { await replyNotice(interaction, '⚠️ Voting has ended.'); return true; }
    if (!isVoter(v, userId)) { await replyNotice(interaction, '⚠️ You are not part of this vote session.'); return true; }
    if (v.finished.has(userId)) { await replyNotice(interaction, '⚠️ You already finished your vote.'); return true; }
    if (!v.voteSubmitted.has(userId)) { await replyNotice(interaction, '⚠️ Submit your vote before finishing.'); return true; }

    await interaction.deferUpdate();

    v.finished.add(userId);
    if (areAllVotersFinished(v)) {
      await finalizeCompletedVote(v);
      return true;
    }

    await safeEditMessage(v.publicMessage, buildRenderPayload(v));
    return true;
  }

  if (parsed.action === 'randomvote') {
    if (v.status !== 'in_progress' || v.phase !== 'voting') { await replyNotice(interaction, '⚠️ Voting has ended.'); return true; }
    if (!isVoter(v, userId)) { await replyNotice(interaction, '⚠️ You are not part of this vote session.'); return true; }
    if (v.finished.has(userId)) { await replyNotice(interaction, '⚠️ You already finished your vote.'); return true; }

    const randomized = new Map<string, string>();
    for (const q of v.questions) {
      randomized.set(q.id, pickRandomVoteValue(q));
    }

    commitVoteRecord(v, userId, randomized);
    v.stagedVotesByVoter.set(userId, new Map(randomized));
    v.voteSubmitted.add(userId);

    const emptyBans = getEmptyBans();
    v.bansByVoter.set(userId, emptyBans);
    v.stagedBansByVoter.set(userId, emptyBans);
    v.bansSubmitted.delete(userId);

    await interaction.deferUpdate();

    v.finished.add(userId);
    if (areAllVotersFinished(v)) {
      await finalizeCompletedVote(v);
      return true;
    }

    await safeEditMessage(v.publicMessage, buildRenderPayload(v));
    return true;
  }

  if (parsed.action === 'ban') {
    if (v.status !== 'in_progress' || v.phase !== 'voting') { await replyNotice(interaction, '⚠️ Bans are closed.'); return true; }
    if (!isVoter(v, userId)) { await replyNotice(interaction, '⚠️ You are not part of this vote session.'); return true; }
    if (v.finished.has(userId)) { await replyNotice(interaction, '⚠️ You already finished your vote.'); return true; }

    await replySafe(interaction, { ...buildBansPanelViewPayload(v, userId), flags: MessageFlags.Ephemeral });
    return true;
  }

  if (parsed.action === 'bannav') {
    if (v.status !== 'in_progress' || v.phase !== 'voting') { await replyNotice(interaction, '⚠️ Bans are closed.'); return true; }
    if (!isVoter(v, userId)) { await replyNotice(interaction, '⚠️ You are not part of this vote session.'); return true; }
    if (v.finished.has(userId)) { await replyNotice(interaction, '⚠️ You already finished your vote.'); return true; }

    const page = getBanPageState(v, userId);
    const leaders = getLeaderBanSource(v);
    const civs = getCivBanSource(v);

    const leaderKeys = sortKeysByGameId(leaders);
    const civKeys = civs ? sortKeysByGameId(civs) : [];

    const leaderPages = Math.max(1, Math.ceil(leaderKeys.length / BAN_LEADER_PAGE_SIZE));
    const civPages = civs ? Math.max(1, Math.ceil(civKeys.length / BAN_CIV_PAGE_SIZE)) : 1;

    const delta = parsed.navDir === 'next' ? 1 : -1;

    if (parsed.banType === 'leader') {
      const next = Math.min(Math.max(page.leaderPage + delta, 0), leaderPages - 1);
      setBanPageState(v, userId, { leaderPage: next, civPage: page.civPage });
    } else {
      const next = Math.min(Math.max(page.civPage + delta, 0), civPages - 1);
      setBanPageState(v, userId, { leaderPage: page.leaderPage, civPage: next });
    }

    const payload = buildBansPanelViewPayload(v, userId);
    await interaction.update({ embeds: payload.embeds, components: payload.components });
    return true;
  }

  if (parsed.action === 'bansubmit') {
    if (v.status !== 'in_progress' || v.phase !== 'voting') { await replyNotice(interaction, '⚠️ Bans are closed.'); return true; }
    if (!isVoter(v, userId)) { await replyNotice(interaction, '⚠️ You are not part of this vote session.'); return true; }
    if (v.finished.has(userId)) { await replyNotice(interaction, '⚠️ You already finished your vote.'); return true; }
    if (!hasStagedBanChanges(v, userId)) { await replyNotice(interaction, '⚠️ No new ban changes to submit.'); return true; }

    const bans = normalizeBanSubmission(v, ensureStagedBans(v, userId));
    v.bansByVoter.set(userId, cloneBanSubmission(bans));
    v.bansSubmitted.add(userId);
    v.stagedBansByVoter.set(userId, cloneBanSubmission(bans));
    await safeEditMessage(v.publicMessage, buildRenderPayload(v));

    const payload = buildBansPanelViewPayload(v, userId);
    await interaction.update({ embeds: payload.embeds, components: payload.components });
    return true;
  }

  return true;
}

export async function handleGameVoteModal(interaction: ModalSubmitInteraction): Promise<boolean> {
  const parsed = parseCustomId(interaction.customId);
  if (!parsed || parsed.action !== 'ban') return false;

  await replyNotice(
    interaction,
    '⚠️ Bans are now submitted via the **Submit Bans** button (emoji menus), not via the modal.'
  );

  return true;
}
