import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  StringSelectMenuBuilder,
  type ButtonInteraction,
  type Guild,
  type InteractionReplyOptions,
  type MessageEditOptions,
  type MessageCreateOptions,
  type ModalSubmitInteraction,
  type Message,
  type StringSelectMenuInteraction,
  type User,
} from 'discord.js';
import { createHash, randomUUID } from 'node:crypto';

import { getGameVoteBanLimits, getVoteDurationMs } from '../config/draft.config.js';
import { buildGameVoteConfig } from '../config/voting.config.js';
import type { VoteQuestion } from '../config/types.js';
import { CIV6_LEADERS, formatCiv6Leader } from '../data/civ6.data.js';
import { CIV7_CIVS, CIV7_LEADERS, formatCiv7Civ, formatCiv7Leader } from '../data/civ7.data.js';
import { executeVoteDraft } from './drafting/orchestration.service.js';
import { buildGameVoteEmbed } from '../ui/embeds/voting.js';
import type {
  GameVoteSession,
  GameVoteDraftMode,
  GameVoteProgress,
  GameVoteVoter,
  StartGameVoteOptions,
  StartGameVoteResult,
  VoteRecord,
  BanSubmission,
} from '../types/voting.types.js';
import type { VoteDraftRequest } from '../types/drafting.types.js';

const BAN_LEADER_PAGE_SIZE = 25;
const BAN_CIV_PAGE_SIZE = 24; // includes a 'None' option


const activeById = new Map<string, GameVoteSession>();
const activeByVoice = new Map<string, GameVoteSession>();
const reservedByVoice = new Set<string>();
const completedCleanupBySession = new Map<string, NodeJS.Timeout>();
const COMPLETED_SESSION_RETENTION_MS = 15 * 60_000;

function voiceKey(guildId: string, voiceChannelId: string): string {
  return `${guildId}:${voiceChannelId}`;
}

function majorityThreshold(n: number): number {
  return Math.floor(n / 2) + 1;
}

const MULTI_VALUE_DELIMITER = '|';

function getQuestionMaxSelections(question: VoteQuestion): number {
  return Math.max(1, Math.min(question.options.length, question.maxSelections ?? 1));
}

function isMultiSelectQuestion(question: VoteQuestion): boolean {
  return getQuestionMaxSelections(question) > 1;
}

function decodeVoteSelections(question: VoteQuestion, stored?: string): string[] {
  if (!stored) return [];
  if (!isMultiSelectQuestion(question)) return [stored].filter(Boolean);

  const allowed = new Set(question.options.map((option) => option.id));
  return dedupeStable(stored.split(MULTI_VALUE_DELIMITER).map((value) => value.trim()).filter((value) => allowed.has(value)))
    .slice(0, getQuestionMaxSelections(question));
}

function encodeVoteSelections(question: VoteQuestion, selectedIds: readonly string[]): string | null {
  const allowed = new Set(question.options.map((option) => option.id));
  const orderById = new Map(question.options.map((option, index) => [option.id, index] as const));
  const normalized = dedupeStable(selectedIds)
    .filter((value) => allowed.has(value))
    .sort((a, b) => (orderById.get(a) ?? 0) - (orderById.get(b) ?? 0))
    .slice(0, getQuestionMaxSelections(question));

  if (normalized.length === 0) return null;
  return isMultiSelectQuestion(question) ? normalized.join(MULTI_VALUE_DELIMITER) : normalized[0] ?? null;
}

function pickRandomVoteValue(question: VoteQuestion): string {
  if (!isMultiSelectQuestion(question)) return pickRandom(question.options).id;

  const count = Math.max(1, Math.min(getQuestionMaxSelections(question), 1 + Math.floor(Math.random() * getQuestionMaxSelections(question))));
  const pool = question.options.map((option) => option.id);
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  return encodeVoteSelections(question, pool.slice(0, count)) ?? question.defaultOptionId;
}

function pickLabelsForQuestion(question: VoteQuestion, stored?: string): string {
  const selections = decodeVoteSelections(question, stored);
  if (selections.length === 0) return '—';

  return selections
    .map((selectedId) => {
      const option = question.options.find((candidate) => candidate.id === selectedId);
      return option ? `${option.emoji ? `${option.emoji} ` : ''}${option.label}` : selectedId;
    })
    .join(', ');
}


function pickRandom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function replySafe(
  interaction: ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction,
  payload: InteractionReplyOptions,
): Promise<void> {
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(payload);
      return;
    }
    await interaction.reply(payload);
  } catch {
    // ignore
  }
}

async function replyNotice(
  interaction: ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction,
  content: string,
): Promise<void> {
  const base = { content, allowedMentions: { parse: [] as const } } as const;
  const payload = interaction.inGuild()
    ? ({ ...base, flags: MessageFlags.Ephemeral } as const)
    : base;
  await replySafe(interaction, payload);
}

function buildProgress(v: GameVoteSession): GameVoteProgress {
  return {
    edition: v.edition,
    status: v.status,
    voters: v.voters,
    finishedIds: new Set(v.finished),
  };
}


type RenderPayload = Omit<MessageCreateOptions, 'flags'> & Omit<MessageEditOptions, 'flags'>;

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

function banSubmissionEquals(a: BanSubmission, b: BanSubmission): boolean {
  return a.leaderKeys.length === b.leaderKeys.length
    && a.civKeys.length === b.civKeys.length
    && a.leaderKeys.every((key, idx) => key === b.leaderKeys[idx])
    && a.civKeys.every((key, idx) => key === b.civKeys[idx]);
}

function getCommittedVoteRecordForVoter(v: GameVoteSession, voterId: string): VoteRecord {
  const record = new Map<string, string>();
  for (const q of v.questions) {
    const optId = v.votesByQuestion.get(q.id)?.get(voterId);
    if (optId) record.set(q.id, optId);
  }
  return record;
}

function ensureStagedVoteRecord(v: GameVoteSession, voterId: string): VoteRecord {
  const existing = v.stagedVotesByVoter.get(voterId);
  if (existing) return existing;
  const created = getCommittedVoteRecordForVoter(v, voterId);
  v.stagedVotesByVoter.set(voterId, created);
  return created;
}

function ensureStagedBans(v: GameVoteSession, voterId: string): BanSubmission {
  const existing = v.stagedBansByVoter.get(voterId);
  if (existing) return existing;
  const created = normalizeBanSubmission(v, cloneBanSubmission(v.bansByVoter.get(voterId) ?? getEmptyBans()));
  v.stagedBansByVoter.set(voterId, created);
  return created;
}

function answeredCountInRecord(v: GameVoteSession, record: ReadonlyMap<string, string>): number {
  let count = 0;
  for (const q of v.questions) if (record.has(q.id)) count += 1;
  return count;
}

function firstUnansweredQuestionIdInRecord(v: GameVoteSession, record: ReadonlyMap<string, string>): string | null {
  for (const q of v.questions) {
    if (!record.has(q.id)) return q.id;
  }
  return null;
}

function voteRecordEquals(a: ReadonlyMap<string, string>, b: ReadonlyMap<string, string>): boolean {
  if (a.size != b.size) return false;
  for (const [key, value] of a) if (b.get(key) !== value) return false;
  return true;
}

function hasStagedVoteChanges(v: GameVoteSession, voterId: string): boolean {
  return !voteRecordEquals(ensureStagedVoteRecord(v, voterId), getCommittedVoteRecordForVoter(v, voterId));
}

function hasStagedBanChanges(v: GameVoteSession, voterId: string): boolean {
  return !banSubmissionEquals(ensureStagedBans(v, voterId), v.bansByVoter.get(voterId) ?? getEmptyBans());
}

function commitVoteRecord(v: GameVoteSession, userId: string, record: ReadonlyMap<string, string>): void {
  for (const q of v.questions) {
    const optId = record.get(q.id);
    const rec = v.votesByQuestion.get(q.id) ?? new Map<string, string>();
    if (optId) rec.set(userId, optId);
    else rec.delete(userId);
    v.votesByQuestion.set(q.id, rec);
  }
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

function formatLeaderBan(v: GameVoteSession, key: string): string {
  return v.edition === 'CIV6' ? formatCiv6Leader(key) : formatCiv7Leader(key);
}

function formatCivBan(key: string): string {
  return formatCiv7Civ(key);
}


function getSubmittedBanSummary(v: GameVoteSession): Readonly<{ leader: ReadonlyMap<string, number>; civ: ReadonlyMap<string, number> }> {
  const leader = new Map<string, number>();
  const civ = new Map<string, number>();

  for (const voterId of v.voterIds) {
    if (!v.bansSubmitted.has(voterId)) continue;
    const bans = v.bansByVoter.get(voterId);
    if (!bans) continue;
    for (const key of bans.leaderKeys) leader.set(key, (leader.get(key) ?? 0) + 1);
    if (v.edition === 'CIV7') for (const key of bans.civKeys) civ.set(key, (civ.get(key) ?? 0) + 1);
  }

  return { leader, civ };
}

function buildVerticalBanSection(label: string, items: readonly string[], maxLength: number): string {
  const header = `• ${label} (${items.length})`;
  const lines = [header];
  let used = header.length;

  if (items.length === 0) {
    return `${header}\n• None`;
  }

  for (let i = 0; i < items.length; i += 1) {
    const line = items[i];
    const remaining = items.length - i;
    const overflowLine = `(+${remaining} more)`;

    if (used + 1 + line.length > maxLength) {
      if (lines.length === 1) {
        return `${header}\n${overflowLine}`;
      }
      if (used + 1 + overflowLine.length <= maxLength) {
        lines.push(overflowLine);
      }
      return lines.join('\n');
    }

    lines.push(line);
    used += 1 + line.length;
  }

  return lines.join('\n');
}

function buildBansQuestionValue(v: GameVoteSession): string {
  const summary = getSubmittedBanSummary(v);
  const leaderEntries = [...summary.leader.entries()];
  const civEntries = [...summary.civ.entries()];

  if (leaderEntries.length === 0 && civEntries.length === 0) {
    return v.status === 'completed' ? '• None' : '• Pending';
  }

  const sections: string[] = [];
  let remaining = 1000;

  const finalLeaderKeys = v.status === 'completed'
    ? majorityBans(v.voterIds, new Map(v.voterIds.map((id) => [id, new Set(v.bansSubmitted.has(id) ? (v.bansByVoter.get(id) ?? getEmptyBans()).leaderKeys : [])])))
    : leaderEntries.map(([key]) => key);
  const finalCivKeys = v.status === 'completed' && v.edition === 'CIV7'
    ? majorityBans(v.voterIds, new Map(v.voterIds.map((id) => [id, new Set(v.bansSubmitted.has(id) ? (v.bansByVoter.get(id) ?? getEmptyBans()).civKeys : [])])))
    : civEntries.map(([key]) => key);

  const leaderItems = finalLeaderKeys.map((key) => `${formatLeaderBan(v, key)} ×${summary.leader.get(key) ?? 0}`);
  if (leaderItems.length > 0) {
    sections.push(buildVerticalBanSection('Leader bans', leaderItems, remaining));
    remaining = Math.max(128, 1000 - sections.join('\n\n').length);
  }

  if (v.edition === 'CIV7') {
    const civItems = finalCivKeys.map((key) => `${formatCivBan(key)} ×${summary.civ.get(key) ?? 0}`);
    if (civItems.length > 0) {
      sections.push(buildVerticalBanSection('Civ bans', civItems, remaining));
    }
  }

  return sections.join('\n\n') || '• None';
}

function buildQuestionFields(v: GameVoteSession): readonly { name: string; value: string; inline?: boolean }[] {
  if (v.status === 'closed') return [];

  const showWinners = v.status === 'completed';
  const bansIndex = v.questions.length + 1;
  const bansTitle = showWinners ? `${bansIndex}. Bans` : `${bansIndex}. Ban Votes`;
  const bansBlock = [`**${bansTitle}**`, buildBansQuestionValue(v)].join('\n');

  if (!showWinners) {
    const blocks = v.questions.map((q, idx) => {
      const header = `**${idx + 1}. ${q.title}**`;
      const counts = voteCountByOption(q, v.votesByQuestion.get(q.id) ?? new Map<string, string>());
      const lines = q.options.map((o) => {
        const count = counts.get(o.id) ?? 0;
        return `• ${o.emoji ? `${o.emoji} ` : ''}${o.label}${count > 0 ? ` ×${count}` : ''}`;
      });
      return [header, ...lines].join('\n');
    });
    blocks.push(bansBlock);

    const left = blocks.slice(0, 5).join('\n\n');
    const right = blocks.slice(5).join('\n\n');

    if (left.length <= 1024 && right.length <= 1024) {
      return [
        { name: 'Questions (1–5)', value: left || '—', inline: true },
        { name: 'Questions (6–10)', value: right || '—', inline: true },
      ];
    }

    return [
      ...v.questions.map((q, idx) => {
        const name = `${idx + 1}. ${q.title}`;
        const counts = voteCountByOption(q, v.votesByQuestion.get(q.id) ?? new Map<string, string>());
        const lines = q.options.map((o) => `• ${o.emoji ? `${o.emoji} ` : ''}${o.label}${(counts.get(o.id) ?? 0) > 0 ? ` ×${counts.get(o.id) ?? 0}` : ''}`);
        return { name, value: lines.join('\n') || '—' };
      }),
      { name: bansTitle, value: buildBansQuestionValue(v) },
    ];
  }

  return [
    ...v.questions.map((q, idx) => {
      const name = `${idx + 1}. ${q.title}`;
      const winnerId = v.lockedSettings.get(q.id) ?? q.defaultOptionId;
      const winner = q.options.find((o) => o.id === winnerId);
      const label = winner ? `${winner.emoji ? `${winner.emoji} ` : ''}${winner.label}` : winnerId;
      const count = (v.votesByQuestion.get(q.id) && voteCountByOption(q, v.votesByQuestion.get(q.id)!).get(winnerId)) ?? 0;
      const tb = v.tiebrokenQuestions.has(q.id) ? ' *(tiebreak)*' : '';
      return { name, value: `**${label}**${count > 0 ? ` ×${count}` : ''}${tb}` };
    }),
    { name: bansTitle, value: buildBansQuestionValue(v) },
  ];
}


function buildVotingButtons(v: GameVoteSession): readonly ActionRowBuilder<ButtonBuilder>[] {
  const voteBtn = new ButtonBuilder()
    .setCustomId(`gv:ballot:${v.sessionId}`)
    .setStyle(ButtonStyle.Primary)
    .setLabel('🗳️ Vote Panel');

  const bansBtn = new ButtonBuilder()
    .setCustomId(`gv:ban:${v.sessionId}`)
    .setStyle(ButtonStyle.Primary)
    .setLabel('🔨 Ban Panel');

  const finishBtn = new ButtonBuilder()
    .setCustomId(`gv:finishvote:${v.sessionId}`)
    .setStyle(ButtonStyle.Success)
    .setLabel('➕ Finish Vote');

  const randomizeBtn = new ButtonBuilder()
    .setCustomId(`gv:randomvote:${v.sessionId}`)
    .setStyle(ButtonStyle.Danger)
    .setLabel('🎲 Randomize My Vote');

  return [new ActionRowBuilder<ButtonBuilder>().addComponents(voteBtn, bansBtn, finishBtn, randomizeBtn)];
}

function nextBallotQuestionId(v: GameVoteSession, voterId: string, currentQuestionId: string): string {
  const currentIndex = v.questions.findIndex((q) => q.id === currentQuestionId);
  if (currentIndex < 0) return currentQuestionId;

  const staged = ensureStagedVoteRecord(v, voterId);
  for (let i = currentIndex + 1; i < v.questions.length; i += 1) {
    const question = v.questions[i];
    if (!staged.has(question.id)) return question.id;
  }

  return v.questions[currentIndex + 1]?.id ?? currentQuestionId;
}

function buildBallotEmbed(
  v: GameVoteSession,
  voterId: string,
  activeQuestionId: string,
  stagedRecord: ReadonlyMap<string, string> = ensureStagedVoteRecord(v, voterId)
): EmbedBuilder {
  const ends = Math.floor(v.endsAtMs / 1000);
  const hasDirtyChanges = !voteRecordEquals(stagedRecord, getCommittedVoteRecordForVoter(v, voterId));
  const submitted = v.voteSubmitted.has(voterId) && !hasDirtyChanges;
  const header =
    v.status !== 'in_progress'
      ? '**Voting has ended.**'
      : `**Ends:** <t:${ends}:t>
Answer all questions, then press **Submit Vote**. You can keep editing until **Finish Vote**.`;

  const lines = v.questions.map((q, idx) => {
    const pickLabel = pickLabelsForQuestion(q, stagedRecord.get(q.id));
    const mark = stagedRecord.has(q.id) ? '✅' : '⬜';
    const cursor = q.id === activeQuestionId ? '➡️ ' : '';
    return `${cursor}${mark} ${idx + 1}. ${q.title} — ${pickLabel}`;
  });

  const footer = submitted
    ? `

✅ **Vote saved** — you can reopen this panel and keep editing until **Finish Vote**.`
    : '';

  return new EmbedBuilder()
    .setTitle('🗳️ Vote Panel')
    .setDescription([header, '', lines.join('\n') || '—'].join('\n') + footer);
}

function buildBallotComponents(
  v: GameVoteSession,
  voterId: string,
  activeQuestionId: string,
  stagedRecord: ReadonlyMap<string, string> = ensureStagedVoteRecord(v, voterId)
): readonly ActionRowBuilder<any>[] {
  const finished = v.finished.has(voterId);
  const total = v.questions.length;
  const answered = answeredCountInRecord(v, stagedRecord);
  const canSubmit = !finished && answered >= total && !voteRecordEquals(stagedRecord, getCommittedVoteRecordForVoter(v, voterId));
  const activeIndex = Math.max(0, v.questions.findIndex((q) => q.id === activeQuestionId));

  const q = v.questions[activeIndex] ?? v.questions[0];
  const currentSelections = decodeVoteSelections(q, stagedRecord.get(q.id));
  const maxSelections = getQuestionMaxSelections(q);

  const optionSelect = new StringSelectMenuBuilder()
    .setCustomId(`gv:ballotv:${v.sessionId}`)
    .setPlaceholder(
      (isMultiSelectQuestion(q)
        ? `Select up to ${maxSelections} options for ${q.title}`
        : `Select an option for ${q.title}`).slice(0, 150)
    )
    .setMinValues(1)
    .setMaxValues(maxSelections)
    .setDisabled(finished)
    .addOptions(
      q.options.slice(0, 25).map((o) => ({
        label: `${o.emoji ? `${o.emoji} ` : ''}${o.label}`.slice(0, 100),
        value: o.id,
        default: currentSelections.includes(o.id),
      }))
    );

  const prevBtn = new ButtonBuilder()
    .setCustomId(`gv:ballotnav:prev:${v.sessionId}`)
    .setStyle(ButtonStyle.Secondary)
    .setLabel('◀ Back')
    .setDisabled(finished || activeIndex <= 0);

  const nextBtn = new ButtonBuilder()
    .setCustomId(`gv:ballotnav:next:${v.sessionId}`)
    .setStyle(ButtonStyle.Secondary)
    .setLabel('Next ▶')
    .setDisabled(finished || activeIndex >= total - 1);

  const submitBtn = new ButtonBuilder()
    .setCustomId(`gv:submitvote:${v.sessionId}`)
    .setStyle(ButtonStyle.Success)
    .setLabel('Submit Vote')
    .setDisabled(!canSubmit);

  return [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(optionSelect),
    new ActionRowBuilder<ButtonBuilder>().addComponents(prevBtn, nextBtn, submitBtn),
  ];
}

function buildBallotPayload(
  v: GameVoteSession,
  voterId: string,
  activeQuestionId: string,
  stagedRecord: ReadonlyMap<string, string> = ensureStagedVoteRecord(v, voterId)
): RenderPayload {
  return {
    embeds: [buildBallotEmbed(v, voterId, activeQuestionId, stagedRecord)],
    components: [...buildBallotComponents(v, voterId, activeQuestionId, stagedRecord)],
    allowedMentions: { parse: [] as const },
  };
}

function sortKeysByGameId(source: Record<string, { gameId: string }>): string[] {
  return Object.entries(source)
    .sort((a, b) => a[1].gameId.localeCompare(b[1].gameId))
    .map(([key]) => key);
}

function getBanPageState(v: GameVoteSession, voterId: string): { leaderPage: number; civPage: number } {
  return v.banPages.get(voterId) ?? { leaderPage: 0, civPage: 0 };
}

function setBanPageState(
  v: GameVoteSession,
  voterId: string,
  next: Readonly<{ leaderPage: number; civPage: number }>
): void {
  v.banPages.set(voterId, { leaderPage: next.leaderPage, civPage: next.civPage });
}

function mergePagedBanSelection(
  currentKeys: readonly string[],
  pageKeys: readonly string[],
  selectedKeys: readonly string[]
): string[] {
  const pageSet = new Set(pageKeys);
  const out = currentKeys.filter((key) => !pageSet.has(key));
  out.push(...selectedKeys);
  return dedupeStable(out);
}

function getLeaderBanSource(v: GameVoteSession): Record<string, { gameId: string; emojiId?: string }> {
  if (v.edition === 'CIV6') return getCiv6LeaderMeta();
  return getCiv7LeaderMeta();
}

function getCivBanSource(v: GameVoteSession): Record<string, { gameId: string; emojiId?: string }> | null {
  if (v.edition !== 'CIV7') return null;
  return getCiv7CivMeta();
}

function toSelectEmoji(emojiId?: string): { id: string } | undefined {
  return emojiId ? { id: emojiId } : undefined;
}

function clampBanList(items: readonly string[], maxLength: number): string {
  if (items.length === 0) return '—';
  const out: string[] = [];
  let used = 0;
  for (let i = 0; i < items.length; i += 1) {
    const piece = i === 0 ? items[i] : `, ${items[i]}`;
    const remaining = items.length - i;
    const overflow = ` (+${remaining} more)`;
    if (used + piece.length > maxLength) {
      if (out.length === 0) return overflow.trim();
      if (used + overflow.length <= maxLength) out.push(overflow);
      break;
    }
    out.push(piece);
    used += piece.length;
  }
  return out.join('');
}

function buildBansPanelEmbed(v: GameVoteSession, voterId: string): EmbedBuilder {
  const bans = ensureStagedBans(v, voterId);
  const submitted = v.bansSubmitted.has(voterId) && !hasStagedBanChanges(v, voterId);

  const leaderItems = bans.leaderKeys.map((key) => formatLeaderBan(v, key));
  const civItems = v.edition === 'CIV7' ? bans.civKeys.map((key) => formatCivBan(key)) : [];

  const desc: string[] = [
    'Choose one or more bans with the menus below, then press **Submit Bans**.',
    `**Leader bans (${leaderItems.length}):** ${clampBanList(leaderItems, 900)}`,
    v.edition === 'CIV7' ? `**Civ bans (${civItems.length}):** ${clampBanList(civItems, 900)}` : undefined,
    submitted ? '✅ **Bans saved** — you can reopen this panel and keep editing until **Finish Vote**.' : undefined,
  ].filter(Boolean) as string[];

  return new EmbedBuilder().setTitle('🛑 Bans').setDescription(desc.join('\n'));
}

function buildBansPanelComponents(
  v: GameVoteSession,
  voterId: string
): readonly ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[] {
  const finished = v.finished.has(voterId);
  const leaders = getLeaderBanSource(v);
  const civs = getCivBanSource(v);

  const leaderKeys = sortKeysByGameId(leaders);
  const civKeys = civs ? sortKeysByGameId(civs) : [];

  const page = getBanPageState(v, voterId);
  const leaderPages = Math.max(1, Math.ceil(leaderKeys.length / BAN_LEADER_PAGE_SIZE));
  const civPages = civs ? Math.max(1, Math.ceil(civKeys.length / BAN_CIV_PAGE_SIZE)) : 1;

  const leaderPage = Math.min(Math.max(page.leaderPage, 0), leaderPages - 1);
  const civPage = Math.min(Math.max(page.civPage, 0), civPages - 1);

  if (leaderPage !== page.leaderPage || civPage !== page.civPage) {
    setBanPageState(v, voterId, { leaderPage, civPage });
  }

  const bans = ensureStagedBans(v, voterId);
  const limits = getBanLimits(v);
  const selectedLeaders = new Set(bans.leaderKeys);
  const selectedCivs = new Set(bans.civKeys);

  const leaderSlice = leaderKeys.slice(
    leaderPage * BAN_LEADER_PAGE_SIZE,
    leaderPage * BAN_LEADER_PAGE_SIZE + BAN_LEADER_PAGE_SIZE
  );

  const leaderOptions = leaderSlice.map((key) => {
    const meta = leaders[key];
    return {
      label: meta?.gameId ?? key,
      value: key,
      emoji: toSelectEmoji(meta?.emojiId),
      default: selectedLeaders.has(key),
    };
  });
  const selectedLeaderOnPage = leaderSlice.filter((key) => selectedLeaders.has(key)).length;
  const selectedLeaderOffPage = bans.leaderKeys.length - selectedLeaderOnPage;
  const leaderMaxOnPage = Math.min(leaderOptions.length, Math.max(0, limits.leader - selectedLeaderOffPage));

  const leaderMenu = new StringSelectMenuBuilder()
    .setCustomId(`gv:banpick:leader:${v.sessionId}`)
    .setPlaceholder(`Leader bans (page ${leaderPage + 1}/${leaderPages})`)
    .setMinValues(0)
    .setMaxValues(Math.max(1, leaderMaxOnPage || selectedLeaderOnPage || 1))
    .setDisabled(finished || leaderOptions.length === 0 || (leaderMaxOnPage === 0 && selectedLeaderOnPage === 0))
    .addOptions(leaderOptions);

  const rows: ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[] = [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(leaderMenu),
  ];

  if (civs) {
    const civSlice = civKeys.slice(civPage * BAN_CIV_PAGE_SIZE, civPage * BAN_CIV_PAGE_SIZE + BAN_CIV_PAGE_SIZE);

    const civOptions = civSlice.map((key) => {
      const meta = civs[key];
      return {
        label: meta?.gameId ?? key,
        value: key,
        emoji: toSelectEmoji(meta?.emojiId),
        default: selectedCivs.has(key),
      };
    });
    const selectedCivOnPage = civSlice.filter((key) => selectedCivs.has(key)).length;
    const selectedCivOffPage = bans.civKeys.length - selectedCivOnPage;
    const civMaxOnPage = Math.min(civOptions.length, Math.max(0, limits.civ - selectedCivOffPage));

    const civMenu = new StringSelectMenuBuilder()
      .setCustomId(`gv:banpick:civ:${v.sessionId}`)
      .setPlaceholder(`Civ bans (optional) (page ${civPage + 1}/${civPages})`)
      .setMinValues(0)
      .setMaxValues(Math.max(1, civMaxOnPage || selectedCivOnPage || 1))
      .setDisabled(finished || civOptions.length === 0 || (civMaxOnPage === 0 && selectedCivOnPage === 0))
      .addOptions(civOptions);

    rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(civMenu));
  }

  const navRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`gv:bannav:leader:prev:${v.sessionId}`)
      .setStyle(ButtonStyle.Secondary)
      .setLabel('◀ Back')
      .setDisabled(finished || leaderPages <= 1),
    new ButtonBuilder()
      .setCustomId(`gv:bannav:leader:next:${v.sessionId}`)
      .setStyle(ButtonStyle.Secondary)
      .setLabel('Next ▶')
      .setDisabled(finished || leaderPages <= 1)
  );

  if (civs) {
    navRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`gv:bannav:civ:prev:${v.sessionId}`)
        .setStyle(ButtonStyle.Secondary)
        .setLabel('◀ Back')
        .setDisabled(finished || civPages <= 1),
      new ButtonBuilder()
        .setCustomId(`gv:bannav:civ:next:${v.sessionId}`)
        .setStyle(ButtonStyle.Secondary)
        .setLabel('Next ▶')
        .setDisabled(finished || civPages <= 1)
    );
  }

  navRow.addComponents(
    new ButtonBuilder()
      .setCustomId(`gv:bansubmit:${v.sessionId}`)
      .setStyle(ButtonStyle.Success)
      .setLabel('Submit Bans')
      .setDisabled(finished)
  );

  rows.push(navRow);

  return rows;
}

function buildBansPanelPayload(v: GameVoteSession, voterId: string): InteractionReplyOptions {
  return {
    embeds: [buildBansPanelEmbed(v, voterId)],
    components: buildBansPanelComponents(v, voterId),
    flags: MessageFlags.Ephemeral,
  };
}
 
function buildRenderPayload(v: GameVoteSession): RenderPayload {
  const progress = buildProgress(v);
  const questionFields = buildQuestionFields(v);

  const embed = buildGameVoteEmbed({
    edition: v.edition,
    gameType: v.gameType,
    startingAge: v.startingAge,
    status: v.status,
    phase: v.phase,
    startedAtMs: v.startedAtMs,
    endsAtMs: v.endsAtMs,
    completedAtMs: v.completedAtMs,
    progress,
    questionFields,
    voteUuid: v.sessionId,
  });

  const components = v.status === 'in_progress' && v.phase === 'voting'
    ? buildVotingButtons(v)
    : [];

  return {
    embeds: [embed],
    components: [...components],
    allowedMentions: { parse: [] as const },
  };
}



async function safeEditMessage(
  msg: Message,
  payload: RenderPayload
): Promise<void> {
  try {
    if (!msg.editable) return;
    await msg.edit({
      ...payload,
      allowedMentions: { parse: [] as const },
    });
  } catch {
    // ignore
  }
}

function voteCountByOption(question: VoteQuestion, record: VoteRecord): Map<string, number> {
  const counts = new Map<string, number>();
  for (const stored of record.values()) {
    for (const optId of decodeVoteSelections(question, stored)) {
      counts.set(optId, (counts.get(optId) ?? 0) + 1);
    }
  }
  return counts;
}

function pickDeterministic(sessionId: string, questionId: string, optionIds: readonly string[]): { winnerId: string; seed: string } {
  const seedFull = createHash('sha256').update(`${sessionId}:${questionId}`).digest('hex');
  const seed = seedFull.slice(0, 8);
  const n = Number.parseInt(seed, 16);
  const idx = optionIds.length > 0 ? n % optionIds.length : 0;
  return { winnerId: optionIds[Math.max(0, idx)], seed };
}

function selectWinner(
  sessionId: string,
  question: VoteQuestion,
  record: VoteRecord,
  voterIds: readonly string[],
  tiebrokenQuestions: Set<string>
): string {
  // If not everyone voted, fall back to default (existing behavior).
  if (record.size < voterIds.length) return question.defaultOptionId;

  const counts = voteCountByOption(question, record);
  const entries = [...counts.entries()].sort((a, b) => b[1] - a[1]);

  if (entries.length === 0) return question.defaultOptionId;

  const max = entries[0][1];
  const tied = entries.filter(([, c]) => c === max).map(([id]) => id);

  if (tied.length === 1) return tied[0];

  const { winnerId, seed } = pickDeterministic(sessionId, question.id, tied);
  tiebrokenQuestions.add(question.id);

  console.info('[gamevote] tiebreak', {
    sessionId,
    questionId: question.id,
    tied,
    winnerId,
    seed,
  });

  return winnerId;
}

function ensureLockedAll(v: GameVoteSession) {
  for (const q of v.questions) {
    if (v.lockedSettings.has(q.id)) continue;

    const record = v.votesByQuestion.get(q.id);
    if (!record) {
      v.lockedSettings.set(q.id, q.defaultOptionId);
      continue;
    }

    const winner = selectWinner(v.sessionId, q, record, v.voterIds, v.tiebrokenQuestions);
    v.lockedSettings.set(q.id, winner);
  }
}

function getDraftMode(v: GameVoteSession): GameVoteDraftMode {
  ensureLockedAll(v);

  const q = v.questions.find((x) => x.id === 'draft_mode');
  if (!q) return 'standard';

  const optId = v.lockedSettings.get(q.id) ?? q.defaultOptionId;
  const opt = q.options.find((o) => o.id === optId);
  return (opt?.id as GameVoteDraftMode) ?? 'standard';
}



function getCiv6LeaderMeta(): Record<string, { gameId: string; emojiId?: string }> {
  return CIV6_LEADERS as unknown as Record<string, { gameId: string; emojiId?: string }>;
}

function getCiv7LeaderMeta(): Record<string, { gameId: string; emojiId?: string }> {
  return CIV7_LEADERS as unknown as Record<string, { gameId: string; emojiId?: string }>;
}

function getCiv7CivMeta(): Record<string, { gameId: string; emojiId?: string }> {
  return CIV7_CIVS as unknown as Record<string, { gameId: string; emojiId?: string }>;
}

function majorityBans<K extends string>(
  voterIds: readonly string[],
  perVoter: ReadonlyMap<string, ReadonlySet<K>>
): readonly K[] {
  const need = majorityThreshold(voterIds.length);
  const counts = new Map<K, number>();

  for (const id of voterIds) {
    const set = perVoter.get(id);
    if (!set) continue;
    for (const key of set) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }

  const out: K[] = [];
  for (const [key, count] of counts) {
    if (count >= need) out.push(key);
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

  try {
    const msg = await v.commandChannel.send(payload);
    if (!msg.inGuild()) return { ok: false, message: '⚠️ This command must be used in a server channel.' };
    if (msg.guildId !== guild.id) return { ok: false, message: '⚠️ Internal error: guild mismatch.' };
    v.publicMessage = msg;
    return { ok: true };
  } catch (err: unknown) {
    console.error('gamevote initial send failed', {
      sessionId: v.sessionId,
      guildId: v.guildId,
      channelId: 'id' in v.commandChannel ? v.commandChannel.id : undefined,
      edition: v.edition,
      gameType: v.gameType,
      error: err,
    });
    const code = typeof err === 'object' && err && 'code' in err ? (err as { code?: unknown }).code : undefined;
    const detail = formatUnknownError(err);
    const extra = typeof code === 'number' || typeof code === 'string'
      ? ` (Discord error ${code})`
      : detail
        ? ` (${detail})`
        : '';
    return { ok: false, message: `⚠️ I couldn't post the vote message in that channel${extra}.` };
  }
}

function clearCompletedCleanup(sessionId: string): void {
  const timeout = completedCleanupBySession.get(sessionId);
  if (!timeout) return;
  clearTimeout(timeout);
  completedCleanupBySession.delete(sessionId);
}

function scheduleCompletedCleanup(v: GameVoteSession, retainForMs: number): void {
  clearCompletedCleanup(v.sessionId);
  const timeout = setTimeout(() => {
    activeById.delete(v.sessionId);
    completedCleanupBySession.delete(v.sessionId);
  }, retainForMs);
  completedCleanupBySession.set(v.sessionId, timeout);
}

async function finalizeCleanup(v: GameVoteSession, retainCompletedForMs = 0): Promise<void> {
  if (v.timeout) { clearTimeout(v.timeout); v.timeout = null; }
  activeByVoice.delete(voiceKey(v.guildId, v.voiceChannelId));

  if (retainCompletedForMs > 0) {
    scheduleCompletedCleanup(v, retainCompletedForMs);
    return;
  }

  clearCompletedCleanup(v.sessionId);
  activeById.delete(v.sessionId);
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

  if (v.timeout) {
    clearTimeout(v.timeout);
    v.timeout = null;
  }

  v.phase = 'final';
  v.status = 'closed';
  v.isFinalized = true;

  await safeEditMessage(v.publicMessage, buildRenderPayload(v));
  await finalizeCleanup(v);
}

async function finalizeCompletedVote(v: GameVoteSession): Promise<void> {
  if (v.isFinalized) return;
  if (v.status !== 'in_progress') return;

  if (v.timeout) {
    clearTimeout(v.timeout);
    v.timeout = null;
  }

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
  const vkey = voiceKey(args.guild.id, args.voiceChannelId);
  if (activeByVoice.has(vkey) || reservedByVoice.has(vkey)) {
    return { ok: false, message: '⚠️ A vote is already running for that voice channel.' };
  }

  reservedByVoice.add(vkey);

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

    v.timeout = setTimeout(() => void closeVote(v), getVoteDurationMs(args.edition));

    const init = await openInitialMessages(v, args.guild);
    if (!init.ok) {
      if (v.timeout) { clearTimeout(v.timeout); v.timeout = null; }
      return { ok: false, message: init.message };
    }

    activeById.set(sessionId, v);
    activeByVoice.set(vkey, v);

    return { ok: true, sessionId };
  } finally {
    reservedByVoice.delete(vkey);
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



function getSessionById(sessionId: string): GameVoteSession | null {
  return activeById.get(sessionId) ?? null;
}

function isVoter(v: GameVoteSession, userId: string): boolean {
  return v.voterIds.includes(userId);
}

export async function handleGameVoteSelect(interaction: StringSelectMenuInteraction): Promise<boolean> {
  const parsed = parseCustomId(interaction.customId);
  if (!parsed) return false;

  const v = getSessionById(parsed.sessionId);
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
  await interaction.update(buildBallotPayload(v, userId, active, stagedRecord));

  return true;
}



export async function handleGameVoteButton(interaction: ButtonInteraction): Promise<boolean> {
  const parsed = parseCustomId(interaction.customId);
  if (!parsed) return false;

  const v = getSessionById(parsed.sessionId);
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
      ...buildBallotPayload(v, userId, active),
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
    await interaction.update(buildBallotPayload(v, userId, nextQuestion.id));
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
      ? buildBallotPayload(v, userId, active, staged)
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
    if (v.voterIds.every((id) => v.finished.has(id))) {
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
    if (v.voterIds.every((id) => v.finished.has(id))) {
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

    await replySafe(interaction, buildBansPanelPayload(v, userId));
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

    const payload = buildBansPanelPayload(v, userId);
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

    const payload = buildBansPanelPayload(v, userId);
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
