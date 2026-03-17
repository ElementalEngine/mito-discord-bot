import {
  ActionRowBuilder,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';

import { finalizeCompletedVote } from '../services/voting/completion.service.js';
import {
  getQuestionMaxSelections,
  encodeVoteSelections,
  pickRandomVoteValue,
} from '../services/voting/domain/tally.service.js';
import { formatBanInputIssues, resolveTypedBanInput } from '../services/voting/domain/ban-input.service.js';
import { areAllVotersFinished } from '../services/voting/domain/progress.service.js';
import {
  buildBansPanelViewPayload,
  BAN_CIV_PAGE_SIZE,
  BAN_LEADER_PAGE_SIZE,
  getCivBanSource,
  getLeaderBanSource,
  sortKeysByGameId,
} from '../services/voting/panels/bans-panel.service.js';
import { buildBallotPayload } from '../services/voting/panels/vote-panel.service.js';
import { buildRenderPayload } from '../services/voting/panels/public-message.service.js';
import {
  getVoteSessionById,
} from '../services/voting/runtime/session-runtime.service.js';
import {
  getBanPageState,
  setBanPageState,
  ensureStagedBans,
  mergePagedBanSelection,
  hasStagedBanChanges,
  getEmptyBans,
  cloneBanSubmission,
  normalizeBanSubmission,
} from '../services/voting/runtime/bans-state.service.js';
import {
  replySafe,
  replyNotice,
  safeEditMessage,
} from '../services/voting/runtime/message-ops.service.js';
import {
  ensureStagedVoteRecord,
  firstUnansweredQuestionIdInRecord,
  nextBallotQuestionId,
  hasStagedVoteChanges,
  commitVoteRecord,
} from '../services/voting/runtime/vote-state.service.js';
import type { GameVoteSession } from '../types/voting.types.js';

type ParsedCustomId =
  | Readonly<{
    action: 'ballot' | 'ballotv' | 'submitvote' | 'finishvote' | 'randomvote' | 'ban' | 'bansubmit';
    sessionId: string;
  }>
  | Readonly<{ action: 'ballotnav'; navDir: 'prev' | 'next'; sessionId: string }>
  | Readonly<{ action: 'pick'; pickType: 'civ' | 'leader'; sessionId: string }>
  | Readonly<{ action: 'nav'; pickType: 'civ' | 'leader'; navDir: 'prev' | 'next'; sessionId: string }>
  | Readonly<{ action: 'banpick' | 'bantext' | 'bantextsubmit'; banType: 'civ' | 'leader'; sessionId: string }>
  | Readonly<{ action: 'bannav'; banType: 'civ' | 'leader'; navDir: 'prev' | 'next'; sessionId: string }>;


function parseCustomId(id: string): ParsedCustomId | null {
  const parts = id.split(':');
  if (parts[0] !== 'gv') return null;

  const action = parts[1] as ParsedCustomId['action'];

  if (action === 'pick') {
    const pickType = parts[2] as 'civ' | 'leader';
    const sessionId = parts[3];
    if (!sessionId || (pickType !== 'civ' && pickType !== 'leader')) return null;
    return { action: 'pick', pickType, sessionId };
  }

  if (action === 'nav') {
    const pickType = parts[2] as 'civ' | 'leader';
    const navDir = parts[3] as 'prev' | 'next';
    const sessionId = parts[4];
    if (!sessionId || (pickType !== 'civ' && pickType !== 'leader')) return null;
    if (navDir !== 'prev' && navDir !== 'next') return null;
    return { action: 'nav', pickType, navDir, sessionId };
  }

  if (action === 'banpick' || action === 'bantext' || action === 'bantextsubmit') {
    const banType = parts[2] as 'civ' | 'leader';
    const sessionId = parts[3];
    if (!sessionId || (banType !== 'civ' && banType !== 'leader')) return null;
    return { action, banType, sessionId };
  }

  if (action === 'bannav') {
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

function buildBanTextModal(sessionId: string, banType: 'leader' | 'civ'): ModalBuilder {
  const noun = banType === 'leader' ? 'Leader' : 'Civ';
  const modal = new ModalBuilder()
    .setCustomId(`gv:bantextsubmit:${banType}:${sessionId}`)
    .setTitle(`Type ${noun} Bans`)
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('tokens')
          .setLabel(`${noun} bans`)
          .setPlaceholder(
            banType === 'leader'
              ? 'Cleopatra, :trajan:, <:_romecaesar_:123>'
              : 'Roman, :egyptian:, Maya'
          )
          .setRequired(true)
          .setStyle(TextInputStyle.Paragraph)
      )
    );

  return modal;
}

export async function handleGameVoteSelect(
  interaction: StringSelectMenuInteraction
): Promise<boolean> {
  const parsed = parseCustomId(interaction.customId);
  if (!parsed) return false;

  const v = getVoteSessionById(parsed.sessionId);
  if (!v) {
    await replyNotice(interaction, '⚠️ This vote session has ended or is invalid.');
    return true;
  }

  const userId = interaction.user.id;

  if (parsed.action === 'banpick') {
    if (v.status !== 'in_progress' || v.phase !== 'voting') {
      await replyNotice(interaction, '⚠️ Bans are closed.');
      return true;
    }
    if (!isVoter(v, userId)) {
      await replyNotice(interaction, '⚠️ You are not part of this vote session.');
      return true;
    }
    if (v.finished.has(userId)) {
      await replyNotice(interaction, '⚠️ You already finished your vote.');
      return true;
    }

    const cur = ensureStagedBans(v, userId);
    const prevLeaderKeys = cur.leaderKeys.join('\u0000');
    const prevCivKeys = cur.civKeys.join('\u0000');

    if (parsed.banType === 'leader') {
      const leaders = getLeaderBanSource(v);
      const leaderKeys = sortKeysByGameId(leaders);
      const page = getBanPageState(v, userId);
      const leaderSlice = leaderKeys.slice(
        page.leaderPage * BAN_LEADER_PAGE_SIZE,
        page.leaderPage * BAN_LEADER_PAGE_SIZE + BAN_LEADER_PAGE_SIZE
      );

      v.stagedBansByVoter.set(
        userId,
        normalizeBanSubmission(v, {
          leaderKeys: mergePagedBanSelection(cur.leaderKeys, leaderSlice, interaction.values),
          civKeys: cur.civKeys,
        })
      );
    } else {
      if (v.edition !== 'CIV7') {
        await replyNotice(interaction, '⚠️ Civ bans are not available for Civ6.');
        return true;
      }
      const civs = getCivBanSource(v);
      if (!civs) {
        await replyNotice(interaction, '⚠️ Civ bans are not available right now.');
        return true;
      }
      const civKeys = sortKeysByGameId(civs);
      const page = getBanPageState(v, userId);
      const civSlice = civKeys.slice(
        page.civPage * BAN_CIV_PAGE_SIZE,
        page.civPage * BAN_CIV_PAGE_SIZE + BAN_CIV_PAGE_SIZE
      );

      v.stagedBansByVoter.set(
        userId,
        normalizeBanSubmission(v, {
          leaderKeys: cur.leaderKeys,
          civKeys: mergePagedBanSelection(cur.civKeys, civSlice, interaction.values),
        })
      );
    }

    const next = ensureStagedBans(v, userId);
    if (
      prevLeaderKeys === next.leaderKeys.join('\u0000')
      && prevCivKeys === next.civKeys.join('\u0000')
    ) {
      await interaction.deferUpdate();
      return true;
    }

    const payload = buildBansPanelViewPayload(v, userId);
    await interaction.update({ embeds: payload.embeds, components: payload.components });
    return true;
  }

  if (!interaction.inCachedGuild()) return true;
  if (parsed.action !== 'ballotv') return true;

  if (v.status !== 'in_progress' || v.phase !== 'voting') {
    await replyNotice(interaction, '⚠️ Voting has ended.');
    return true;
  }
  if (!isVoter(v, userId)) {
    await replyNotice(interaction, '⚠️ You are not part of this vote session.');
    return true;
  }
  if (v.finished.has(userId)) {
    await replyNotice(interaction, '⚠️ You already finished your vote.');
    return true;
  }

  const stagedRecord = ensureStagedVoteRecord(v, userId);
  const activeFromState =
    v.activeQuestionByVoter.get(userId) ??
    firstUnansweredQuestionIdInRecord(v, stagedRecord) ??
    v.questions[0]?.id;

  if (!activeFromState) {
    await replyNotice(interaction, '⚠️ No questions available.');
    return true;
  }

  const qid = activeFromState;
  const q = v.questions.find((qq) => qq.id === qid);
  if (!q) {
    await replyNotice(interaction, '⚠️ Invalid question context.');
    return true;
  }

  const selectedIds = interaction.values;
  const maxSelections = getQuestionMaxSelections(q);
  const validSelection =
    selectedIds.length > 0 &&
    selectedIds.length <= maxSelections &&
    selectedIds.every((optId) => q.options.some((option) => option.id === optId));

  if (!validSelection) {
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
  if (
    prev === nextStored &&
    (v.activeQuestionByVoter.get(userId) ?? activeFromState) === nextActive
  ) {
    await interaction.deferUpdate();
    return true;
  }

  stagedRecord.set(qid, nextStored);
  if (prev !== nextStored && v.voteSubmitted.has(userId)) {
    v.voteSubmitted.delete(userId);
  }

  v.activeQuestionByVoter.set(userId, nextActive);

  const active = v.activeQuestionByVoter.get(userId) ?? activeFromState;
  await interaction.update(
    buildBallotPayload({
      session: v,
      voterId: userId,
      activeQuestionId: active,
      stagedRecord,
    })
  );

  return true;
}

export async function handleGameVoteButton(
  interaction: ButtonInteraction
): Promise<boolean> {
  const parsed = parseCustomId(interaction.customId);
  if (!parsed) return false;

  const v = getVoteSessionById(parsed.sessionId);
  if (!v) {
    await replyNotice(interaction, '⚠️ This vote session has ended or is invalid.');
    return true;
  }

  const userId = interaction.user.id;

  if (parsed.action === 'ballot') {
    if (v.status !== 'in_progress' || v.phase !== 'voting') {
      await replyNotice(interaction, '⚠️ Voting has ended.');
      return true;
    }
    if (!isVoter(v, userId)) {
      await replyNotice(interaction, '⚠️ You are not part of this vote session.');
      return true;
    }
    if (v.finished.has(userId)) {
      await replyNotice(interaction, '⚠️ You already finished your vote.');
      return true;
    }

    const active =
      v.activeQuestionByVoter.get(userId) ??
      firstUnansweredQuestionIdInRecord(v, ensureStagedVoteRecord(v, userId)) ??
      v.questions[0]?.id;

    if (!active) {
      await replyNotice(interaction, '⚠️ No questions available.');
      return true;
    }

    v.activeQuestionByVoter.set(userId, active);

    await replySafe(interaction, {
      ...buildBallotPayload({ session: v, voterId: userId, activeQuestionId: active }),
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (parsed.action === 'ballotnav') {
    if (v.status !== 'in_progress' || v.phase !== 'voting') {
      await replyNotice(interaction, '⚠️ Voting has ended.');
      return true;
    }
    if (!isVoter(v, userId)) {
      await replyNotice(interaction, '⚠️ You are not part of this vote session.');
      return true;
    }
    if (v.finished.has(userId)) {
      await replyNotice(interaction, '⚠️ You already finished your vote.');
      return true;
    }

    const currentId =
      v.activeQuestionByVoter.get(userId) ??
      firstUnansweredQuestionIdInRecord(v, ensureStagedVoteRecord(v, userId)) ??
      v.questions[0]?.id;
    if (!currentId) {
      await replyNotice(interaction, '⚠️ No questions available.');
      return true;
    }

    const currentIndex = v.questions.findIndex((q) => q.id === currentId);
    const nextIndex = parsed.navDir === 'next' ? currentIndex + 1 : currentIndex - 1;
    const nextQuestion = v.questions[nextIndex];
    if (!nextQuestion) {
      await interaction.deferUpdate();
      return true;
    }

    v.activeQuestionByVoter.set(userId, nextQuestion.id);
    await interaction.update(
      buildBallotPayload({ session: v, voterId: userId, activeQuestionId: nextQuestion.id })
    );
    return true;
  }

  if (parsed.action === 'submitvote') {
    if (v.status !== 'in_progress' || v.phase !== 'voting') {
      await replyNotice(interaction, '⚠️ Voting has ended.');
      return true;
    }
    if (!isVoter(v, userId)) {
      await replyNotice(interaction, '⚠️ You are not part of this vote session.');
      return true;
    }
    if (v.finished.has(userId)) {
      await replyNotice(interaction, '⚠️ You already finished your vote.');
      return true;
    }

    const staged = ensureStagedVoteRecord(v, userId);
    const missing = firstUnansweredQuestionIdInRecord(v, staged);
    if (missing) {
      await replyNotice(interaction, '⚠️ Answer all questions before submitting your vote.');
      return true;
    }
    if (!hasStagedVoteChanges(v, userId)) {
      await replyNotice(interaction, '⚠️ No new vote changes to submit.');
      return true;
    }

    commitVoteRecord(v, userId, staged);

    v.voteSubmitted.add(userId);
    v.stagedVotesByVoter.set(userId, new Map(staged));
    await safeEditMessage(v.publicMessage, buildRenderPayload(v));

    const active =
      v.activeQuestionByVoter.get(userId) ??
      firstUnansweredQuestionIdInRecord(v, staged) ??
      v.questions[0]?.id;
    const payload = active
      ? buildBallotPayload({
        session: v,
        voterId: userId,
        activeQuestionId: active,
        stagedRecord: staged,
      })
      : {
        embeds: [new EmbedBuilder().setDescription('Vote submitted.')],
        components: [],
        allowedMentions: { parse: [] as const },
      };

    try {
      await interaction.update(payload);
    } catch {
      await replySafe(interaction, { ...payload, flags: MessageFlags.Ephemeral });
    }

    return true;
  }

  if (parsed.action === 'finishvote') {
    if (v.status !== 'in_progress' || v.phase !== 'voting') {
      await replyNotice(interaction, '⚠️ Voting has ended.');
      return true;
    }
    if (!isVoter(v, userId)) {
      await replyNotice(interaction, '⚠️ You are not part of this vote session.');
      return true;
    }
    if (v.finished.has(userId)) {
      await replyNotice(interaction, '⚠️ You already finished your vote.');
      return true;
    }
    if (!v.voteSubmitted.has(userId)) {
      await replyNotice(interaction, '⚠️ Submit your vote before finishing.');
      return true;
    }

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
    if (v.status !== 'in_progress' || v.phase !== 'voting') {
      await replyNotice(interaction, '⚠️ Voting has ended.');
      return true;
    }
    if (!isVoter(v, userId)) {
      await replyNotice(interaction, '⚠️ You are not part of this vote session.');
      return true;
    }
    if (v.finished.has(userId)) {
      await replyNotice(interaction, '⚠️ You already finished your vote.');
      return true;
    }

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

  if (parsed.action === 'bantext') {
    if (v.status !== 'in_progress' || v.phase !== 'voting') {
      await replyNotice(interaction, '⚠️ Bans are closed.');
      return true;
    }
    if (!isVoter(v, userId)) {
      await replyNotice(interaction, '⚠️ You are not part of this vote session.');
      return true;
    }
    if (v.finished.has(userId)) {
      await replyNotice(interaction, '⚠️ You already finished your vote.');
      return true;
    }
    if (parsed.banType === 'civ' && v.edition !== 'CIV7') {
      await replyNotice(interaction, '⚠️ Civ bans are not available for Civ6.');
      return true;
    }

    await interaction.showModal(buildBanTextModal(v.sessionId, parsed.banType));
    return true;
  }

  if (parsed.action === 'ban') {
    if (v.status !== 'in_progress' || v.phase !== 'voting') {
      await replyNotice(interaction, '⚠️ Bans are closed.');
      return true;
    }
    if (!isVoter(v, userId)) {
      await replyNotice(interaction, '⚠️ You are not part of this vote session.');
      return true;
    }
    if (v.finished.has(userId)) {
      await replyNotice(interaction, '⚠️ You already finished your vote.');
      return true;
    }

    await replySafe(interaction, {
      ...buildBansPanelViewPayload(v, userId),
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (parsed.action === 'bannav') {
    if (v.status !== 'in_progress' || v.phase !== 'voting') {
      await replyNotice(interaction, '⚠️ Bans are closed.');
      return true;
    }
    if (!isVoter(v, userId)) {
      await replyNotice(interaction, '⚠️ You are not part of this vote session.');
      return true;
    }
    if (v.finished.has(userId)) {
      await replyNotice(interaction, '⚠️ You already finished your vote.');
      return true;
    }

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
    if (v.status !== 'in_progress' || v.phase !== 'voting') {
      await replyNotice(interaction, '⚠️ Bans are closed.');
      return true;
    }
    if (!isVoter(v, userId)) {
      await replyNotice(interaction, '⚠️ You are not part of this vote session.');
      return true;
    }
    if (v.finished.has(userId)) {
      await replyNotice(interaction, '⚠️ You already finished your vote.');
      return true;
    }
    if (!hasStagedBanChanges(v, userId)) {
      await replyNotice(interaction, '⚠️ No new ban changes to submit.');
      return true;
    }

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

export async function handleGameVoteModal(
  interaction: ModalSubmitInteraction
): Promise<boolean> {
  const parsed = parseCustomId(interaction.customId);
  if (!parsed || parsed.action !== 'bantextsubmit') return false;

  const v = getVoteSessionById(parsed.sessionId);
  if (!v) {
    await replyNotice(interaction, '⚠️ This vote session has ended or is invalid.');
    return true;
  }

  const userId = interaction.user.id;
  if (v.status !== 'in_progress' || v.phase !== 'voting') {
    await replyNotice(interaction, '⚠️ Bans are closed.');
    return true;
  }
  if (!isVoter(v, userId)) {
    await replyNotice(interaction, '⚠️ You are not part of this vote session.');
    return true;
  }
  if (v.finished.has(userId)) {
    await replyNotice(interaction, '⚠️ You already finished your vote.');
    return true;
  }
  if (parsed.banType === 'civ' && v.edition !== 'CIV7') {
    await replyNotice(interaction, '⚠️ Civ bans are not available for Civ6.');
    return true;
  }

  const raw = interaction.fields.getTextInputValue('tokens');
  const resolved = resolveTypedBanInput(v, parsed.banType, raw);
  if (resolved.keys.length === 0) {
    const issues = formatBanInputIssues(resolved.unknownTokens, resolved.ambiguousTokens) ?? 'No valid bans were found.';
    await replyNotice(interaction, `⚠️ No valid ${parsed.banType} bans were found.\n${issues}`);
    return true;
  }

  const current = ensureStagedBans(v, userId);
  const next = normalizeBanSubmission(
    v,
    parsed.banType === 'leader'
      ? { leaderKeys: resolved.keys, civKeys: current.civKeys }
      : { leaderKeys: current.leaderKeys, civKeys: resolved.keys }
  );

  v.stagedBansByVoter.set(userId, next);
  const payload = buildBansPanelViewPayload(v, userId);

  if (interaction.isFromMessage()) {
    await interaction.update({ embeds: payload.embeds, components: payload.components });
  } else {
    await replySafe(interaction, { ...payload, flags: MessageFlags.Ephemeral });
  }

  const issues = formatBanInputIssues(resolved.unknownTokens, resolved.ambiguousTokens);
  if (issues) {
    await replySafe(interaction, {
      content: `⚠️ Some entries were ignored.\n${issues}`,
      flags: MessageFlags.Ephemeral,
    });
  }

  return true;
}
