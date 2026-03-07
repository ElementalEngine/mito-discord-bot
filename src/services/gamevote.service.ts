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
import { createHash, randomInt, randomUUID } from 'node:crypto';

import { EMOJI_ERROR, EMOJI_FAIL } from '../config/constants.js';
import { buildGameVoteConfig } from '../config/gamevote.config.js';
import type { VoteQuestion } from '../config/types.js';
import { CIV6_LEADERS, formatCiv6Leader } from '../data/civ6-data.js';
import { CIV7_CIVS, CIV7_LEADERS, formatCiv7Civ, formatCiv7Leader } from '../data/civ7-data.js';
import { DraftError, generateCiv6Draft, generateCiv7Draft } from './draft.service.js';
import { buildCiv6DraftEmbed, buildCiv7DraftEmbed } from '../ui/embeds/draft.js';
import { buildGameVoteEmbed } from '../ui/embeds/gamevote.js';
import type {
  GameVoteSession,
  GameVoteDraftMode,
  GameVoteProgress,
  GameVoteVoter,
  StartGameVoteOptions,
  StartGameVoteResult,
  VoteRecord,
  BanSubmission,
} from '../types/gamevote.js';

const VOTE_DURATION_MS = 10 * 60_000;
const BLIND_DRAFT_DURATION_MS = 10 * 60_000;

const DM_CONCURRENCY = 8;
const BLIND_MENU_PAGE_SIZE = 25;
const BAN_LEADER_PAGE_SIZE = 25;
const BAN_CIV_PAGE_SIZE = 24; // includes a 'None' option


const activeById = new Map<string, GameVoteSession>();
const activeByVoice = new Map<string, GameVoteSession>();
const reservedByVoice = new Set<string>();

function voiceKey(guildId: string, voiceChannelId: string): string {
  return `${guildId}:${voiceChannelId}`;
}

function majorityThreshold(n: number): number {
  return Math.floor(n / 2) + 1;
}

function pickRandom<T>(arr: readonly T[]): T {
  return arr[randomInt(0, arr.length)];
}

async function replySafe(
  interaction: ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction,
  payload: InteractionReplyOptions
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
  content: string
): Promise<void> {
  const base = { content, allowedMentions: { parse: [] as const } } as const;
  const payload = interaction.inGuild()
    ? ({ ...base, flags: MessageFlags.Ephemeral } as const)
    : base;
  await replySafe(interaction, payload);
}

async function forEachLimit<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  if (items.length === 0) return;
  const concurrency = Math.max(1, Math.min(limit, items.length));
  let next = 0;

  async function worker(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      try {
        await fn(items[i]);
      } catch {
        // best effort
      }
    }
  }

  await Promise.allSettled(Array.from({ length: concurrency }, () => worker()));
}

function answeredCountByVoter(v: GameVoteSession): Map<string, number> {
  const counts = new Map<string, number>();
  for (const id of v.voterIds) counts.set(id, 0);
  for (const q of v.questions) {
    const rec = v.votesByQuestion.get(q.id);
    if (!rec) continue;
    for (const [voterId] of rec) {
      counts.set(voterId, (counts.get(voterId) ?? 0) + 1);
    }
  }
  return counts;
}

function submittedBanCountsByVoter(v: GameVoteSession): Readonly<{ leader: Map<string, number>; civ: Map<string, number> }> {
  const leader = new Map<string, number>();
  const civ = new Map<string, number>();

  for (const id of v.voterIds) {
    leader.set(id, 0);
    civ.set(id, 0);
  }

  for (const voterId of v.voterIds) {
    if (!v.bansSubmitted.has(voterId)) continue;
    const bans = v.bansByVoter.get(voterId) ?? getEmptyBans();
    leader.set(voterId, bans.leaderKeys.length);
    civ.set(voterId, bans.civKeys.length);
  }

  return { leader, civ };
}

function buildProgress(v: GameVoteSession): GameVoteProgress {
  const banCounts = submittedBanCountsByVoter(v);

  return {
    edition: v.edition,
    status: v.status,
    voters: v.voters,
    totalQuestions: v.questions.length,
    answeredCountById: answeredCountByVoter(v),
    voteSubmittedIds: new Set(v.voteSubmitted),
    leaderBanCountById: banCounts.leader,
    civBanCountById: banCounts.civ,
    finishedIds: new Set(v.finished),
  };
}


type RenderPayload = Omit<MessageCreateOptions, 'flags'> & Omit<MessageEditOptions, 'flags'>;

function getEmptyBans(): BanSubmission {
  return { leaderKeys: [], civKeys: [] };
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


function getSubmittedBanSummary(v: GameVoteSession): Readonly<{ leaderKeys: readonly string[]; civKeys: readonly string[] }> {
  const leaderKeys: string[] = [];
  const civKeys: string[] = [];

  for (const voterId of v.voterIds) {
    if (!v.bansSubmitted.has(voterId)) continue;
    const bans = v.bansByVoter.get(voterId);
    if (!bans) continue;
    leaderKeys.push(...bans.leaderKeys);
    if (v.edition === 'CIV7') civKeys.push(...bans.civKeys);
  }

  return {
    leaderKeys: dedupeStable(leaderKeys),
    civKeys: dedupeStable(civKeys),
  };
}

function buildVerticalBanSection(label: string, items: readonly string[], maxLength: number): string {
  const header = `• ${label} (${items.length})`;
  const lines = [header];
  let used = header.length;

  if (items.length === 0) {
    return `${header}\n• —`;
  }

  for (let i = 0; i < items.length; i += 1) {
    const line = `${items[i]},`;
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

  if (summary.leaderKeys.length === 0 && summary.civKeys.length === 0) {
    return '• Pending';
  }

  const sections: string[] = [];
  let remaining = 1000;

  const leaderItems = summary.leaderKeys.map((key) => formatLeaderBan(v, key));
  if (leaderItems.length > 0) {
    sections.push(buildVerticalBanSection('Leader bans', leaderItems, remaining));
    remaining = Math.max(128, 1000 - sections.join('\n\n').length);
  }

  if (v.edition === 'CIV7') {
    const civItems = summary.civKeys.map((key) => formatCivBan(key));
    if (civItems.length > 0) {
      sections.push(buildVerticalBanSection('Civ bans', civItems, remaining));
    }
  }

  return sections.join('\n\n');
}

function buildQuestionFields(v: GameVoteSession): readonly { name: string; value: string; inline?: boolean }[] {
  if (v.status === 'closed') return [];

  const bansBlock = ['**10. Bans**', buildBansQuestionValue(v)].join('\n');
  const showWinners = v.status === 'completed';

  if (!showWinners) {
    const blocks = v.questions.map((q, idx) => {
      const header = `**${idx + 1}. ${q.title}**`;
      const lines = q.options.map((o) => `• ${o.emoji ? `${o.emoji} ` : ''}${o.label}`);
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
        const lines = q.options.map((o) => `• ${o.emoji ? `${o.emoji} ` : ''}${o.label}`);
        return { name, value: lines.join('\n') || '—' };
      }),
      { name: '10. Bans', value: buildBansQuestionValue(v) },
    ];
  }

  return [
    ...v.questions.map((q, idx) => {
      const name = `${idx + 1}. ${q.title}`;
      const winnerId = v.lockedSettings.get(q.id) ?? q.defaultOptionId;
      const winner = q.options.find((o) => o.id === winnerId);
      const label = winner ? `${winner.emoji ? `${winner.emoji} ` : ''}${winner.label}` : winnerId;
      const tb = v.tiebrokenQuestions.has(q.id) ? ' *(tiebreak)*' : '';
      return { name, value: `✅ **${label}**${tb}` };
    }),
    { name: '10. Bans', value: buildBansQuestionValue(v) },
  ];
}


function buildVotingButtons(v: GameVoteSession): readonly ActionRowBuilder<ButtonBuilder>[] {
  const voteBtn = new ButtonBuilder()
    .setCustomId(`gv:ballot:${v.sessionId}`)
    .setStyle(ButtonStyle.Primary)
    .setLabel('Open Vote Panel');

  const bansBtn = new ButtonBuilder()
    .setCustomId(`gv:ban:${v.sessionId}`)
    .setStyle(ButtonStyle.Secondary)
    .setLabel('Open Bans Panel');

  const finishBtn = new ButtonBuilder()
    .setCustomId(`gv:finishvote:${v.sessionId}`)
    .setStyle(ButtonStyle.Success)
    .setLabel('Finish Vote');

  return [new ActionRowBuilder<ButtonBuilder>().addComponents(voteBtn, bansBtn, finishBtn)];
}

function firstUnansweredQuestionId(v: GameVoteSession, voterId: string): string | null {
  for (const q of v.questions) {
    const rec = v.votesByQuestion.get(q.id);
    if (!rec || !rec.has(voterId)) return q.id;
  }
  return null;
}

function nextBallotQuestionId(v: GameVoteSession, voterId: string, currentQuestionId: string): string {
  const currentIndex = v.questions.findIndex((q) => q.id === currentQuestionId);
  if (currentIndex < 0) return currentQuestionId;

  for (let i = currentIndex + 1; i < v.questions.length; i += 1) {
    const question = v.questions[i];
    if (!v.votesByQuestion.get(question.id)?.has(voterId)) return question.id;
  }

  return v.questions[currentIndex + 1]?.id ?? currentQuestionId;
}

function buildBallotEmbed(v: GameVoteSession, voterId: string, activeQuestionId: string): EmbedBuilder {
  const ends = Math.floor(v.endsAtMs / 1000);
  const submitted = v.voteSubmitted.has(voterId);
  const header =
    v.status !== 'in_progress'
      ? '**Voting has ended.**'
      : `Finish before <t:${ends}:R>. Answer all questions, then press **Submit Vote**. You can keep editing until **Finish Vote**.`;

  const lines = v.questions.map((q, idx) => {
    const rec = v.votesByQuestion.get(q.id);
    const pickId = rec?.get(voterId);
    const pick = pickId ? q.options.find((o) => o.id === pickId) : undefined;
    const pickLabel = pick ? `${pick.emoji ? `${pick.emoji} ` : ''}${pick.label}` : '—';
    const mark = pickId ? '✅' : '⬜';
    const cursor = q.id === activeQuestionId ? '➡️ ' : '';
    return `${cursor}${mark} ${idx + 1}. ${q.title} — ${pickLabel}`;
  });

  const footer = submitted
    ? `\n\n✅ **Vote saved** — you can reopen this panel and keep editing until **Finish Vote**.`
    : '';

  return new EmbedBuilder()
    .setTitle('🗳️ Vote Panel')
    .setDescription([header, '', lines.join('\n') || '—'].join('\n') + footer);
}

function buildBallotComponents(
  v: GameVoteSession,
  voterId: string,
  activeQuestionId: string
): readonly ActionRowBuilder<any>[] {
  const finished = v.finished.has(voterId);
  const submitted = v.voteSubmitted.has(voterId);
  const total = v.questions.length;
  const answered = v.questions.reduce((acc, q) => (v.votesByQuestion.get(q.id)?.has(voterId) ? acc + 1 : acc), 0);
  const canSubmit = !finished && !submitted && answered >= total;
  const activeIndex = Math.max(0, v.questions.findIndex((q) => q.id === activeQuestionId));

  const questionSelect = new StringSelectMenuBuilder()
    .setCustomId(`gv:ballotq:${v.sessionId}`)
    .setPlaceholder('Select a question')
    .setDisabled(finished)
    .addOptions(
      v.questions.slice(0, 25).map((q, idx) => ({
        label: `${idx + 1}. ${q.title}`.slice(0, 100),
        value: q.id,
        description: (v.votesByQuestion.get(q.id)?.has(voterId) ? 'Answered' : 'Not answered').slice(0, 100),
        default: q.id === activeQuestionId,
      }))
    );

  const q = v.questions[activeIndex] ?? v.questions[0];
  const currentPickId = v.votesByQuestion.get(q.id)?.get(voterId);

  const optionSelect = new StringSelectMenuBuilder()
    .setCustomId(`gv:ballotv:${v.sessionId}`)
    .setPlaceholder('Select an option')
    .setDisabled(finished)
    .addOptions(
      q.options.slice(0, 25).map((o) => ({
        label: `${o.emoji ? `${o.emoji} ` : ''}${o.label}`.slice(0, 100),
        value: o.id,
        default: o.id === currentPickId,
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
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(questionSelect),
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(optionSelect),
    new ActionRowBuilder<ButtonBuilder>().addComponents(prevBtn, nextBtn, submitBtn),
  ];
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
  const bans = v.bansByVoter.get(voterId) ?? getEmptyBans();
  const submitted = v.bansSubmitted.has(voterId);

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

  const bans = v.bansByVoter.get(voterId) ?? getEmptyBans();
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

  const leaderMenu = new StringSelectMenuBuilder()
    .setCustomId(`gv:banpick:leader:${v.sessionId}`)
    .setPlaceholder(`Leader bans (page ${leaderPage + 1}/${leaderPages})`)
    .setMinValues(0)
    .setMaxValues(Math.max(1, leaderOptions.length))
    .setDisabled(finished)
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

    const civMenu = new StringSelectMenuBuilder()
      .setCustomId(`gv:banpick:civ:${v.sessionId}`)
      .setPlaceholder(`Civ bans (optional) (page ${civPage + 1}/${civPages})`)
      .setMinValues(0)
      .setMaxValues(Math.max(1, civOptions.length))
      .setDisabled(finished)
      .addOptions(civOptions);

    rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(civMenu));
  }

  const navRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`gv:bannav:leader:prev:${v.sessionId}`)
      .setStyle(ButtonStyle.Secondary)
      .setLabel('◀ Leader')
      .setDisabled(finished || leaderPages <= 1),
    new ButtonBuilder()
      .setCustomId(`gv:bannav:leader:next:${v.sessionId}`)
      .setStyle(ButtonStyle.Secondary)
      .setLabel('Leader ▶')
      .setDisabled(finished || leaderPages <= 1)
  );

  if (civs) {
    navRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`gv:bannav:civ:prev:${v.sessionId}`)
        .setStyle(ButtonStyle.Secondary)
        .setLabel('◀ Civ')
        .setDisabled(finished || civPages <= 1),
      new ButtonBuilder()
        .setCustomId(`gv:bannav:civ:next:${v.sessionId}`)
        .setStyle(ButtonStyle.Secondary)
        .setLabel('Civ ▶')
        .setDisabled(finished || civPages <= 1)
    );
  }

  navRow.addComponents(
    new ButtonBuilder()
      .setCustomId(`gv:bansubmit:${v.sessionId}`)
      .setStyle(ButtonStyle.Success)
      .setLabel('Submit Bans')
      .setDisabled(finished || v.bansSubmitted.has(voterId))
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

function buildBlindPickComponents(args: Readonly<{
  session: GameVoteSession;
  voterId: string;
}>): ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] {
  const v = args.session;
  const pools = v.blindDraftPools.get(args.voterId);
  if (!pools) return [];

  const state = v.blindDraftPages.get(args.voterId) ?? { civPage: 0, leaderPage: 0 };
  const navButtons: ButtonBuilder[] = [];
  const rows: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] = [];

  if (v.edition === 'CIV7' && pools.civs) {
    const totalPages = Math.max(1, Math.ceil(pools.civs.length / BLIND_MENU_PAGE_SIZE));
    const civPage = Math.max(0, Math.min(state.civPage, totalPages - 1));
    if (civPage !== state.civPage) {
      v.blindDraftPages.set(args.voterId, { ...state, civPage });
    }

    const pageKeys = pools.civs.slice(
      civPage * BLIND_MENU_PAGE_SIZE,
      (civPage + 1) * BLIND_MENU_PAGE_SIZE
    );

    const civMenu = new StringSelectMenuBuilder()
      .setCustomId(`gv:pick:civ:${v.sessionId}`)
      .setPlaceholder(
        totalPages > 1 ? `Pick your civ (Page ${civPage + 1}/${totalPages})` : 'Pick your civ'
      )
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(
        pageKeys.map((key: string) => {
          const meta = CIV7_CIVS[key as keyof typeof CIV7_CIVS];
          return { label: meta.gameId, value: key };
        })
      );
    rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(civMenu));

    if (totalPages > 1) {
      navButtons.push(
        new ButtonBuilder()
          .setCustomId(`gv:nav:civ:prev:${v.sessionId}`)
          .setStyle(ButtonStyle.Secondary)
          .setLabel('◀ Civ')
          .setDisabled(civPage <= 0),
        new ButtonBuilder()
          .setCustomId(`gv:nav:civ:next:${v.sessionId}`)
          .setStyle(ButtonStyle.Secondary)
          .setLabel('Civ ▶')
          .setDisabled(civPage >= totalPages - 1)
      );
    }
  }

  const leaderTotalPages = Math.max(1, Math.ceil(pools.leaders.length / BLIND_MENU_PAGE_SIZE));
  const leaderPage = Math.max(0, Math.min(state.leaderPage, leaderTotalPages - 1));
  if (leaderPage !== state.leaderPage) {
    v.blindDraftPages.set(args.voterId, { ...state, leaderPage });
  }

  const leaderPageKeys = pools.leaders.slice(
    leaderPage * BLIND_MENU_PAGE_SIZE,
    (leaderPage + 1) * BLIND_MENU_PAGE_SIZE
  );

  const leaderMenu = new StringSelectMenuBuilder()
    .setCustomId(`gv:pick:leader:${v.sessionId}`)
    .setPlaceholder(
      leaderTotalPages > 1
        ? `Pick your leader (Page ${leaderPage + 1}/${leaderTotalPages})`
        : 'Pick your leader'
    )
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      leaderPageKeys.map((key: string) => {
        const meta =
          v.edition === 'CIV6'
            ? CIV6_LEADERS[key as keyof typeof CIV6_LEADERS]
            : CIV7_LEADERS[key as keyof typeof CIV7_LEADERS];
        return { label: meta.gameId, value: key };
      })
    );
  rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(leaderMenu));

  if (leaderTotalPages > 1) {
    navButtons.push(
      new ButtonBuilder()
        .setCustomId(`gv:nav:leader:prev:${v.sessionId}`)
        .setStyle(ButtonStyle.Secondary)
        .setLabel('◀ Leader')
        .setDisabled(leaderPage <= 0),
      new ButtonBuilder()
        .setCustomId(`gv:nav:leader:next:${v.sessionId}`)
        .setStyle(ButtonStyle.Secondary)
        .setLabel('Leader ▶')
        .setDisabled(leaderPage >= leaderTotalPages - 1)
    );
  }

  if (navButtons.length) {
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(navButtons));
  }

  return rows;
}

function buildRenderPayload(v: GameVoteSession): RenderPayload {
  const progress = buildProgress(v);
  const questionFields = buildQuestionFields(v);

  const embed = buildGameVoteEmbed({
    edition: v.edition,
    gameType: v.gameType,
    startingAge: v.startingAge,
    status: v.status,
    startedAtMs: v.startedAtMs,
    endsAtMs: v.endsAtMs,
    progress,
    questionFields,
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

function voteCountByOption(record: VoteRecord): Map<string, number> {
  const counts = new Map<string, number>();
  for (const optId of record.values()) {
    counts.set(optId, (counts.get(optId) ?? 0) + 1);
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

  const counts = voteCountByOption(record);
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

function keysToColonTokens(keys: readonly string[], source: Record<string, { gameId: string }>): string {
  return keys
    .map((k) => {
      const meta = source[k];
      return meta?.gameId ? `:${meta.gameId}:` : '';
    })
    .filter(Boolean)
    .join('\n');
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



async function finalizeCleanup(v: GameVoteSession): Promise<void> {
  if (v.timeout) { clearTimeout(v.timeout); v.timeout = null; }
  if (v.blindDraftTimeout) {
    clearTimeout(v.blindDraftTimeout);
    v.blindDraftTimeout = null;
  }
  activeById.delete(v.sessionId);
  activeByVoice.delete(voiceKey(v.guildId, v.voiceChannelId));
}

async function publishDraftResult(v: GameVoteSession): Promise<void> {
  const leaderPerVoter = new Map<string, ReadonlySet<string>>();
  const civPerVoter = new Map<string, ReadonlySet<string>>();

  for (const [id, bans] of v.bansByVoter.entries()) {
    if (bans.leaderKeys.length > 0) leaderPerVoter.set(id, new Set(bans.leaderKeys));
    if (v.edition === 'CIV7' && bans.civKeys.length > 0) civPerVoter.set(id, new Set(bans.civKeys));
  }

  const bannedLeaderKeys = majorityBans(v.voterIds, leaderPerVoter);
  const bannedCivKeys = v.edition === 'CIV7' ? majorityBans(v.voterIds, civPerVoter) : [];

  const leaderBansRaw =
    v.edition === 'CIV6'
      ? keysToColonTokens(bannedLeaderKeys, getCiv6LeaderMeta())
      : keysToColonTokens(bannedLeaderKeys, getCiv7LeaderMeta());

  const civBansRaw = v.edition === 'CIV7'
    ? keysToColonTokens(bannedCivKeys, getCiv7CivMeta())
    : undefined;

  const draftMode = getDraftMode(v);

  // For FFA, numberPlayers comes from voter count.
  const numberPlayers = v.gameType === 'FFA' ? v.voters.length : undefined;
  const numberTeams = v.gameType === 'Teamer' ? v.numberTeams : undefined;

  if (draftMode === 'snake') {
    await publishSnake(v);
    return;
  }

  if (draftMode === 'random') {
    await publishRandom(v, bannedLeaderKeys, bannedCivKeys);
    return;
  }

  if (draftMode === 'cwc') {
    await publishCwc(v, bannedLeaderKeys, bannedCivKeys);
    return;
  }

  try {
    if (v.edition === 'CIV6') {
      const draft = generateCiv6Draft({
        gameType: v.gameType,
        numberPlayers,
        numberTeams,
        leaderBansRaw,
      });
      await v.commandChannel.send({ embeds: [buildCiv6DraftEmbed(draft)] });
      return;
    }

    const draft = generateCiv7Draft({
      gameType: v.gameType,
      startingAge: v.startingAge ?? 'Antiquity_Age',
      numberPlayers,
      numberTeams,
      leaderBansRaw,
      civBansRaw,
    });
    await v.commandChannel.send({ embeds: [buildCiv7DraftEmbed(draft)] });
  } catch (err: unknown) {
    const msg = err instanceof DraftError ? err.message : 'Draft failed.';
    await v.commandChannel.send({
      content: `${EMOJI_ERROR} ${msg}`,
      allowedMentions: { parse: [] as const },
    });
  }
}

async function publishSnake(v: GameVoteSession): Promise<void> {
  const order = v.voterIds.slice();

  const lines: string[] = [];
  lines.push(`**Snake draft order** (${v.edition === 'CIV6' ? '1 round' : '2 rounds'})`);
  lines.push('');
  lines.push(
    `Round 1: ${order.map((id: string, i: number) => `${i + 1}. <@${id}>`).join('  ')}`
  );
  if (v.edition === 'CIV7') {
    const rev = order.slice().reverse();
    lines.push('');
    lines.push(
      `Round 2: ${rev.map((id: string, i: number) => `${i + 1}. <@${id}>`).join('  ')}`
    );
  }
  await v.commandChannel.send({
    content: lines.join('\n'),
    allowedMentions: { parse: [] as const },
  });
}

async function publishRandom(
  v: GameVoteSession,
  bannedLeaderKeys: readonly string[],
  bannedCivKeys: readonly string[]
): Promise<void> {
  const bannedLeaders = new Set(bannedLeaderKeys);
  const bannedCivs = new Set(bannedCivKeys);

  if (v.edition === 'CIV6') {
    const pool = Object.keys(CIV6_LEADERS).filter((k) => !bannedLeaders.has(k));
    const lines = v.voterIds.map((id: string) => {
      const pick = pickRandom(pool);
      return `• <@${id}> — **${CIV6_LEADERS[pick as keyof typeof CIV6_LEADERS].gameId}**`;
    });
    await v.commandChannel.send({
      content: `🎲 **Random leaders**\n${lines.join('\n')}`,
      allowedMentions: { parse: [] as const },
    });
    return;
  }

  const leaderPool = Object.keys(CIV7_LEADERS).filter((k) => !bannedLeaders.has(k));
  const allowAllAges = v.startingAge === 'None';
  const civPool = Object.entries(CIV7_CIVS)
    .filter(([key, meta]) => !bannedCivs.has(key) && (allowAllAges || meta.agePool === v.startingAge))
    .map(([key]) => key);

  const lines = v.voterIds.map((id: string) => {
    const leaderKey = pickRandom(leaderPool);
    const civKey = pickRandom(civPool);
    const leader = CIV7_LEADERS[leaderKey as keyof typeof CIV7_LEADERS].gameId;
    const civ = CIV7_CIVS[civKey as keyof typeof CIV7_CIVS].gameId;
    return `• <@${id}> — **${civ}** + **${leader}**`;
  });

  await v.commandChannel.send({
    content: `🎲 **Random civs + leaders**\n${lines.join('\n')}`,
    allowedMentions: { parse: [] as const },
  });
}

async function publishCwc(
  v: GameVoteSession,
  bannedLeaderKeys: readonly string[],
  bannedCivKeys: readonly string[]
): Promise<void> {
  if (v.gameType !== 'Teamer') {
    await v.commandChannel.send({
      content: `${EMOJI_FAIL} CWC is only available for **Teamer**.`,
      allowedMentions: { parse: [] as const },
    });
    return;
  }
  if (v.numberTeams !== 2) {
    await v.commandChannel.send({
      content: `${EMOJI_FAIL} CWC requires **number-teams=2**. Use Standard instead.`,
      allowedMentions: { parse: [] as const },
    });
    return;
  }

  // Expected CWC lobby format: 4v4 (8 voters).
  if (v.voters.length !== 8) {
    await v.commandChannel.send({
      content: `${EMOJI_FAIL} CWC currently supports **8 players** (4v4). Use Standard instead.`,
      allowedMentions: { parse: [] as const },
    });
    return;
  }

  const pickOrder = [0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0] as const;

  const leaderBanned = new Set(bannedLeaderKeys);
  const civBanned = new Set(bannedCivKeys);

  const leaderPoolAll =
    v.edition === 'CIV6'
      ? Object.keys(CIV6_LEADERS).filter((k) => !leaderBanned.has(k))
      : Object.keys(CIV7_LEADERS).filter((k) => !leaderBanned.has(k));

  const leadersPickPool = pickDistinctStable(leaderPoolAll, v.edition === 'CIV6' ? 20 : 20);

  let civPickPool: string[] = [];
  if (v.edition === 'CIV7') {
    const allowAllAges = v.startingAge === 'None';
    const civAll = Object.entries(CIV7_CIVS)
      .filter(([key, meta]) => !civBanned.has(key) && (allowAllAges || meta.agePool === v.startingAge))
      .map(([key]) => key);
    civPickPool = pickDistinctStable(civAll, 14);
  }

  const lines: string[] = [];
  lines.push('**CWC draft** (shared pool)');
  if (v.edition === 'CIV7') {
    lines.push(`Starting Age: **${v.startingAge ?? '—'}**`);
  }
  lines.push('');

  const picksPerRound = 8;
  if (v.edition === 'CIV6') {
    lines.push('**Round 1 (Leaders)**');
    for (let i = 0; i < picksPerRound; i++) {
      lines.push(`Pick ${i + 1}: Team ${pickOrder[i] + 1}`);
    }
  } else {
    lines.push('**Round 1 (Civs)**');
    for (let i = 0; i < picksPerRound; i++) {
      lines.push(`Pick ${i + 1}: Team ${pickOrder[i] + 1}`);
    }
    lines.push('');
    lines.push('**Round 2 (Leaders)**');
    for (let i = 0; i < picksPerRound; i++) {
      lines.push(`Pick ${i + 1}: Team ${pickOrder[picksPerRound + i] + 1}`);
    }
  }

  lines.push('');
  if (v.edition === 'CIV7') {
    lines.push(`**Shared Civ Pool (${civPickPool.length})**`);
    for (const key of civPickPool) {
      lines.push(`• ${CIV7_CIVS[key as keyof typeof CIV7_CIVS].gameId}`);
    }
    lines.push('');
  }

  lines.push(`**Shared Leader Pool (${leadersPickPool.length})**`);
  for (const key of leadersPickPool) {
    const meta =
      v.edition === 'CIV6'
        ? CIV6_LEADERS[key as keyof typeof CIV6_LEADERS]
        : CIV7_LEADERS[key as keyof typeof CIV7_LEADERS];
    lines.push(`• ${meta.gameId}`);
  }

  await v.commandChannel.send({
    content: lines.join('\n'),
    allowedMentions: { parse: [] as const },
  });
}

function pickDistinctStable<T>(pool: readonly T[], count: number): T[] {
  if (count <= 0) return [];
  const copy = pool.slice();
  // shuffle copy
  for (let i = copy.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, Math.min(count, copy.length));
}

async function startBlindDraft(v: GameVoteSession): Promise<void> {
  // Build a standard draft as the per-player pool to pick from.
  const leaderPerVoter = new Map<string, ReadonlySet<string>>();
  const civPerVoter = new Map<string, ReadonlySet<string>>();

  for (const [id, bans] of v.bansByVoter.entries()) {
    if (bans.leaderKeys.length > 0) leaderPerVoter.set(id, new Set(bans.leaderKeys));
    if (v.edition === 'CIV7' && bans.civKeys.length > 0) civPerVoter.set(id, new Set(bans.civKeys));
  }

  const bannedLeaderKeys = majorityBans(v.voterIds, leaderPerVoter);
  const bannedCivKeys = v.edition === 'CIV7' ? majorityBans(v.voterIds, civPerVoter) : [];

  const leaderBansRaw =
    v.edition === 'CIV6'
      ? keysToColonTokens(bannedLeaderKeys, getCiv6LeaderMeta())
      : keysToColonTokens(bannedLeaderKeys, getCiv7LeaderMeta());

  const civBansRaw = v.edition === 'CIV7'
    ? keysToColonTokens(bannedCivKeys, getCiv7CivMeta())
    : undefined;

  const numberPlayers = v.gameType === 'FFA' ? v.voters.length : undefined;
  const numberTeams = undefined;

  try {
    if (v.edition === 'CIV6') {
      const draft = generateCiv6Draft({
        gameType: v.gameType,
        numberPlayers,
        numberTeams,
        leaderBansRaw,
      });
      for (let i = 0; i < v.voterIds.length; i++) {
        const voterId = v.voterIds[i];
        const g = draft.groups[i];
        v.blindDraftPools.set(voterId, { leaders: g.leaders });
        v.blindDraftPages.set(voterId, { civPage: 0, leaderPage: 0 });
      }
    } else {
      const draft = generateCiv7Draft({
        gameType: v.gameType,
        startingAge: v.startingAge ?? 'Antiquity_Age',
        numberPlayers,
        numberTeams,
        leaderBansRaw,
        civBansRaw,
      });
      for (let i = 0; i < v.voterIds.length; i++) {
        const voterId = v.voterIds[i];
        const g = draft.groups[i];
        v.blindDraftPools.set(voterId, { leaders: g.leaders, civs: g.civs ?? [] });
        v.blindDraftPages.set(voterId, { civPage: 0, leaderPage: 0 });
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof DraftError ? err.message : 'Blind draft setup failed.';
    await v.commandChannel.send({
      content: `${EMOJI_ERROR} ${msg}`,
      allowedMentions: { parse: [] as const },
    });
    v.isFinalized = true;
    v.phase = 'final';
    v.status = 'completed';
    await safeEditMessage(v.publicMessage, buildRenderPayload(v));
    await publishDraftResult(v);
    await finalizeCleanup(v);
    return;
  }

  v.phase = 'blind_draft';
  v.status = 'completed';
  v.blindDraftEndsAtMs = Date.now() + BLIND_DRAFT_DURATION_MS;

  // Update public status message.
  await safeEditMessage(v.publicMessage, buildRenderPayload(v));

  
// Push pick UI to each DM (create a DM message if needed).
const basePayload = buildRenderPayload(v);

await forEachLimit<string>(v.voterIds, DM_CONCURRENCY, async (id) => {
  const rows = buildBlindPickComponents({ session: v, voterId: id });

  const existing = v.dmMessages.get(id);
  if (existing) {
    await safeEditMessage(existing, { ...basePayload, components: rows });
    return;
  }

  const user = v.voterUsersById.get(id);
  if (!user) return;

  try {
    const dmMsg = await user.send({ ...basePayload, components: rows });
    v.dmMessages.set(id, dmMsg);
  } catch (err) {
    console.info('[gamevote] dm send failed', { sessionId: v.sessionId, voterId: id, err });
  }
});

  v.blindDraftTimeout = setTimeout(() => {
    void finalizeBlindDraft(v, 'timeout');
  }, BLIND_DRAFT_DURATION_MS);
}

async function finalizeBlindDraft(v: GameVoteSession, reason: 'timeout' | 'complete'): Promise<void> {
  if (v.isFinalized) return;
  if (v.phase !== 'blind_draft') return;

  if (v.blindDraftTimeout) {
    clearTimeout(v.blindDraftTimeout);
    v.blindDraftTimeout = null;
  }

  // Default missing picks.
  for (const id of v.voterIds) {
    const pools = v.blindDraftPools.get(id);
    if (!pools) continue;
    const pick = v.blindDraftPicks.get(id) ?? {};
    if (v.edition === 'CIV6') {
      if (!pick.leaderKey) {
        pick.leaderKey = pickRandom(pools.leaders);
        pick.defaulted = true;
      }
    } else {
      if (!pick.civKey && pools.civs && pools.civs.length > 0) {
        pick.civKey = pickRandom(pools.civs);
        pick.defaulted = true;
      }
      if (!pick.leaderKey) {
        pick.leaderKey = pickRandom(pools.leaders);
        pick.defaulted = true;
      }
    }
    v.blindDraftPicks.set(id, pick);
  }

  const lines: string[] = [];
  lines.push(`✅ **Blind draft results** (${reason === 'timeout' ? 'timeout' : 'complete'})`);
  lines.push('');
  for (const id of v.voterIds) {
    const pick = v.blindDraftPicks.get(id);
    if (!pick) continue;
    const mark = pick.defaulted ? ' *(defaulted)*' : '';
    if (v.edition === 'CIV6') {
      const leader = pick.leaderKey
        ? CIV6_LEADERS[pick.leaderKey as keyof typeof CIV6_LEADERS].gameId
        : '—';
      lines.push(`• <@${id}> — **${leader}**${mark}`);
    } else {
      const civ = pick.civKey
        ? CIV7_CIVS[pick.civKey as keyof typeof CIV7_CIVS].gameId
        : '—';
      const leader = pick.leaderKey
        ? CIV7_LEADERS[pick.leaderKey as keyof typeof CIV7_LEADERS].gameId
        : '—';
      lines.push(`• <@${id}> — **${civ}** + **${leader}**${mark}`);
    }
  }

  await v.commandChannel.send({
    content: lines.join('\n'),
    allowedMentions: { parse: [] as const },
  });

  v.phase = 'final';
  v.status = 'completed';
  v.isFinalized = true;

  await safeEditMessage(v.publicMessage, buildRenderPayload(v));
  await forEachLimit([...v.dmMessages.values()], DM_CONCURRENCY, async (m) => {
    await safeEditMessage(m, { components: [] });
  });

  await finalizeCleanup(v);
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

  if (getDraftMode(v) === 'blind') {
    await startBlindDraft(v);
    return;
  }

  v.phase = 'final';
  v.isFinalized = true;

  await safeEditMessage(v.publicMessage, buildRenderPayload(v));
  await publishDraftResult(v);
  await finalizeCleanup(v);
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

    const { questions } = buildGameVoteConfig({ gameType: args.gameType });

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
      endsAtMs: now + VOTE_DURATION_MS,

      phase: 'voting',
      status: 'in_progress',
      questions,

      votesByQuestion: new Map(),
      lockedSettings: new Map(),
      tiebrokenQuestions: new Set(),
      activeQuestionByVoter: new Map(),

      bansByVoter: new Map(),
      bansSubmitted: new Set(),
      banPages: new Map(),
      voteSubmitted: new Set(),
      finished: new Set(),

      publicMessage: null as unknown as Message<true>,
      dmMessages: new Map(),

      timeout: null,
      isFinalized: false,

      blindDraftEndsAtMs: null,
      blindDraftTimeout: null,
      blindDraftPools: new Map(),
      blindDraftPicks: new Map(),
      blindDraftPages: new Map(),
    };

    v.timeout = setTimeout(() => void closeVote(v), VOTE_DURATION_MS);

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
  | Readonly<{ action: 'ballot' | 'ballotq' | 'ballotv' | 'submitvote' | 'finishvote' | 'ban' | 'bansubmit'; sessionId: string }>
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
    action === 'ballotq' ||
    action === 'ballotv' ||
    action === 'submitvote' ||
    action === 'finishvote' ||
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

  if (parsed.action === 'pick') {
    if (v.phase !== 'blind_draft') { await replyNotice(interaction, '⚠️ Blind draft is not active.'); return true; }
    if (!isVoter(v, userId)) { await replyNotice(interaction, '⚠️ You are not part of this vote session.'); return true; }

    const pickId = interaction.values[0];
    const pick = v.blindDraftPicks.get(userId) ?? {};

    if (parsed.pickType === 'civ') pick.civKey = pickId;
    if (parsed.pickType === 'leader') pick.leaderKey = pickId;

    v.blindDraftPicks.set(userId, pick);

    const components = buildBlindPickComponents({ session: v, voterId: userId });

    await interaction.update({ components });

    if (v.voterIds.every((id) => v.blindDraftPicks.get(id)?.leaderKey)) {
      await finalizeBlindDraft(v, 'complete');
    }
    return true;
  }

  if (parsed.action === 'banpick') {
    if (v.status !== 'in_progress' || v.phase !== 'voting') { await replyNotice(interaction, '⚠️ Bans are closed.'); return true; }
    if (!isVoter(v, userId)) { await replyNotice(interaction, '⚠️ You are not part of this vote session.'); return true; }
    if (v.finished.has(userId)) { await replyNotice(interaction, '⚠️ You already finished your vote.'); return true; }

    const cur = v.bansByVoter.get(userId) ?? getEmptyBans();

    if (parsed.banType === 'leader') {
      const leaders = getLeaderBanSource(v);
      const leaderKeys = sortKeysByGameId(leaders);
      const page = getBanPageState(v, userId);
      const leaderSlice = leaderKeys.slice(
        page.leaderPage * BAN_LEADER_PAGE_SIZE,
        page.leaderPage * BAN_LEADER_PAGE_SIZE + BAN_LEADER_PAGE_SIZE
      );

      v.bansByVoter.set(userId, {
        leaderKeys: mergePagedBanSelection(cur.leaderKeys, leaderSlice, interaction.values),
        civKeys: cur.civKeys,
      });
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

      v.bansByVoter.set(userId, {
        leaderKeys: cur.leaderKeys,
        civKeys: mergePagedBanSelection(cur.civKeys, civSlice, interaction.values),
      });
    }

    if (v.bansSubmitted.has(userId)) {
      await safeEditMessage(v.publicMessage, buildRenderPayload(v));
    }

    const payload = buildBansPanelPayload(v, userId);
    await interaction.update({ embeds: payload.embeds, components: payload.components });
    return true;
  }

  if (!interaction.inCachedGuild()) return true;
  if (parsed.action !== 'ballotq' && parsed.action !== 'ballotv') return true;

  if (v.status !== 'in_progress' || v.phase !== 'voting') { await replyNotice(interaction, '⚠️ Voting has ended.'); return true; }
  if (!isVoter(v, userId)) { await replyNotice(interaction, '⚠️ You are not part of this vote session.'); return true; }
  if (v.finished.has(userId)) { await replyNotice(interaction, '⚠️ You already finished your vote.'); return true; }

  const activeFromState =
    v.activeQuestionByVoter.get(userId) ?? firstUnansweredQuestionId(v, userId) ?? v.questions[0]?.id;

  if (!activeFromState) { await replyNotice(interaction, '⚠️ No questions available.'); return true; }

  let shouldRefreshPublic = false;

  if (parsed.action === 'ballotq') {
    const qid = interaction.values[0];
    if (!v.questions.some((q) => q.id === qid)) { await replyNotice(interaction, '⚠️ Invalid question selection.'); return true; }
    v.activeQuestionByVoter.set(userId, qid);
  } else {
    const qid = activeFromState;
    const q = v.questions.find((qq) => qq.id === qid);
    if (!q) { await replyNotice(interaction, '⚠️ Invalid question context.'); return true; }

    const optId = interaction.values[0];
    if (!q.options.some((o) => o.id === optId)) { await replyNotice(interaction, '⚠️ Invalid option selection.'); return true; }

    const rec = v.votesByQuestion.get(qid) ?? new Map<string, string>();
    shouldRefreshPublic = !rec.has(userId);
    rec.set(userId, optId);
    v.votesByQuestion.set(qid, rec);

    v.activeQuestionByVoter.set(userId, nextBallotQuestionId(v, userId, qid));
  }

  const active = v.activeQuestionByVoter.get(userId) ?? activeFromState;
  const embed = buildBallotEmbed(v, userId, active);
  const components = buildBallotComponents(v, userId, active);

  await interaction.update({ embeds: [embed], components: [...components] });

  if (shouldRefreshPublic) {
    await safeEditMessage(v.publicMessage, buildRenderPayload(v));
  }

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
      v.activeQuestionByVoter.get(userId) ?? firstUnansweredQuestionId(v, userId) ?? v.questions[0]?.id;

    if (!active) { await replyNotice(interaction, '⚠️ No questions available.'); return true; }

    v.activeQuestionByVoter.set(userId, active);

    const embed = buildBallotEmbed(v, userId, active);
    const components = buildBallotComponents(v, userId, active);

    await replySafe(interaction, {
      embeds: [embed],
      components: [...components],
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (parsed.action === 'ballotnav') {
    if (v.status !== 'in_progress' || v.phase !== 'voting') { await replyNotice(interaction, '⚠️ Voting has ended.'); return true; }
    if (!isVoter(v, userId)) { await replyNotice(interaction, '⚠️ You are not part of this vote session.'); return true; }
    if (v.finished.has(userId)) { await replyNotice(interaction, '⚠️ You already finished your vote.'); return true; }

    const currentId =
      v.activeQuestionByVoter.get(userId) ?? firstUnansweredQuestionId(v, userId) ?? v.questions[0]?.id;
    if (!currentId) { await replyNotice(interaction, '⚠️ No questions available.'); return true; }

    const currentIndex = v.questions.findIndex((q) => q.id === currentId);
    const nextIndex = parsed.navDir === 'next' ? currentIndex + 1 : currentIndex - 1;
    const nextQuestion = v.questions[nextIndex];
    if (!nextQuestion) { await interaction.deferUpdate(); return true; }

    v.activeQuestionByVoter.set(userId, nextQuestion.id);
    const embed = buildBallotEmbed(v, userId, nextQuestion.id);
    const components = buildBallotComponents(v, userId, nextQuestion.id);
    await interaction.update({ embeds: [embed], components: [...components] });
    return true;
  }

  if (parsed.action === 'submitvote') {
    if (v.status !== 'in_progress' || v.phase !== 'voting') { await replyNotice(interaction, '⚠️ Voting has ended.'); return true; }
    if (!isVoter(v, userId)) { await replyNotice(interaction, '⚠️ You are not part of this vote session.'); return true; }
    if (v.finished.has(userId)) { await replyNotice(interaction, '⚠️ You already finished your vote.'); return true; }
    if (v.voteSubmitted.has(userId)) { await replyNotice(interaction, '⚠️ You already submitted your vote.'); return true; }

    const missing = firstUnansweredQuestionId(v, userId);
    if (missing) { await replyNotice(interaction, '⚠️ Answer all questions before submitting your vote.'); return true; }

    v.voteSubmitted.add(userId);
    await safeEditMessage(v.publicMessage, buildRenderPayload(v));

    const active =
      v.activeQuestionByVoter.get(userId) ?? firstUnansweredQuestionId(v, userId) ?? v.questions[0]?.id;
    const embed = active ? buildBallotEmbed(v, userId, active) : new EmbedBuilder().setDescription('Vote submitted.');
    const components = active ? buildBallotComponents(v, userId, active) : [];

    try {
      await interaction.update({ embeds: [embed], components: [...components] });
    } catch {
      await replySafe(interaction, { embeds: [embed], components: [...components], flags: MessageFlags.Ephemeral });
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
    await safeEditMessage(v.publicMessage, buildRenderPayload(v));

    if (v.voterIds.every((id) => v.finished.has(id))) {
      await finalizeCompletedVote(v);
    }
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
    if (v.bansSubmitted.has(userId)) { await replyNotice(interaction, '⚠️ You already submitted your bans.'); return true; }

    const bans = v.bansByVoter.get(userId) ?? getEmptyBans();
    if (bans.leaderKeys.length === 0) { await replyNotice(interaction, '⚠️ Pick at least one leader ban first.'); return true; }

    v.bansSubmitted.add(userId);
    await safeEditMessage(v.publicMessage, buildRenderPayload(v));

    const payload = buildBansPanelPayload(v, userId);
    await interaction.update({ embeds: payload.embeds, components: payload.components });
    return true;
  }

  if (parsed.action === 'nav') {
    if (v.phase !== 'blind_draft') { await replyNotice(interaction, '⚠️ Blind draft is not active.'); return true; }
    if (!isVoter(v, userId)) { await replyNotice(interaction, '⚠️ You are not part of this vote session.'); return true; }

    const pages = v.blindDraftPages.get(userId) ?? { civPage: 0, leaderPage: 0 };

    const key = parsed.pickType === 'civ' ? 'civPage' : 'leaderPage';
    const maxPage =
      parsed.pickType === 'civ'
        ? Math.max(
            0,
            Math.ceil((v.blindDraftPools.get(userId)?.civs?.length ?? 0) / BLIND_MENU_PAGE_SIZE) - 1
          )
        : Math.max(
            0,
            Math.ceil(v.blindDraftPools.get(userId)!.leaders.length / BLIND_MENU_PAGE_SIZE) - 1
          );

    const curr = key === 'civPage' ? pages.civPage : pages.leaderPage;
    const next = parsed.navDir === 'next' ? curr + 1 : curr - 1;
    const page = Math.max(0, Math.min(maxPage, next));

    const updated = key === 'civPage' ? { ...pages, civPage: page } : { ...pages, leaderPage: page };
    v.blindDraftPages.set(userId, updated);

    const components = buildBlindPickComponents({ session: v, voterId: userId });
    await interaction.update({ components });

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
