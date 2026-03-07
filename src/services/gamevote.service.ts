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
import { randomInt, randomUUID } from 'node:crypto';

import { EMOJI_ERROR, EMOJI_FAIL } from '../config/constants.js';
import { buildGameVoteConfig } from '../config/gamevote.config.js';
import type { VoteQuestion } from '../config/types.js';
import { CIV6_LEADERS } from '../data/civ6-data.js';
import { CIV7_CIVS, CIV7_LEADERS } from '../data/civ7-data.js';
import { DraftError, generateCiv6Draft, generateCiv7Draft } from './draft.service.js';
import { buildCiv6DraftEmbed, buildCiv7DraftEmbed } from '../ui/embeds/draft.js';
import { buildGameVoteEmbed } from '../ui/embeds/gamevote.js';
import type {
  BanSubmission,
  GameVoteSession,
  GameVoteDraftMode,
  GameVoteProgress,
  GameVoteVoter,
  StartGameVoteOptions,
  StartGameVoteResult,
  VoteRecord,
} from '../types/gamevote.js';

const VOTE_DURATION_MS = 10 * 60_000;
const BLIND_DRAFT_DURATION_MS = 10 * 60_000;

const DM_CONCURRENCY = 8;
const BLIND_MENU_PAGE_SIZE = 25;
const BAN_LEADER_PAGE_SIZE = 25;
const BAN_CIV_PAGE_SIZE = 24;


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

function buildProgress(v: GameVoteSession): GameVoteProgress {
  const answered = answeredCountByVoter(v);
  const blindPicked = new Set<string>();
  if (v.phase === 'blind_draft') {
    for (const [id, pick] of v.blindDraftPicks) {
      if (v.edition === 'CIV6') {
        if (pick.leaderKey) blindPicked.add(id);
      } else {
        if (pick.civKey && pick.leaderKey) blindPicked.add(id);
      }
    }
  }

  return {
    phase: v.phase,
    status: v.status,
    voters: v.voters,
    totalQuestions: v.questions.length,
    answeredCountById: answered,
    bansSubmittedIds: new Set(v.bansSubmitted),
    finishedIds: new Set(v.finished),
    blindDraftPickedIds: blindPicked,
  };
}


type RenderPayload = Omit<MessageCreateOptions, 'flags'> & Omit<MessageEditOptions, 'flags'>;

function buildQuestionFields(v: GameVoteSession): readonly { name: string; value: string; inline?: boolean }[] {
  const showWinners = v.phase !== 'voting';
  const fields: { name: string; value: string; inline?: boolean }[] = [];

  for (let idx = 0; idx < v.questions.length; idx += 2) {
    const pair = v.questions.slice(idx, idx + 2);
    for (const [offset, q] of pair.entries()) {
      const questionIndex = idx + offset;
      const name = `${questionIndex + 1}. ${q.title}`;

      if (showWinners) {
        const winnerId = v.lockedSettings.get(q.id) ?? q.defaultOptionId;
        const winner = q.options.find((o) => o.id === winnerId);
        const label = winner ? `${winner.emoji ? `${winner.emoji} ` : ''}${winner.label}` : winnerId;
        const tb = v.tiebrokenQuestions.has(q.id) ? ' *(tiebreak)*' : '';
        fields.push({ name, value: `✅ **${label}**${tb}`, inline: true });
        continue;
      }

      const lines = q.options.map((o) => `• ${o.emoji ? `${o.emoji} ` : ''}${o.label}`);
      fields.push({ name, value: lines.join('\n') || '—', inline: true });
    }

    if (pair.length === 2 && idx + 2 < v.questions.length) {
      fields.push({ name: '​', value: '​', inline: true });
    }
  }

  return fields;
}


function buildVotingButtons(v: GameVoteSession): readonly ActionRowBuilder<ButtonBuilder>[] {
  const ballotBtn = new ButtonBuilder()
    .setCustomId(`gv:ballot:${v.sessionId}`)
    .setStyle(ButtonStyle.Primary)
    .setLabel('Open Vote Panel');

  const banBtn = new ButtonBuilder()
    .setCustomId(`gv:ban:${v.sessionId}`)
    .setStyle(ButtonStyle.Secondary)
    .setLabel('Open Bans');

  return [new ActionRowBuilder<ButtonBuilder>().addComponents(ballotBtn, banBtn)];
}

function firstUnansweredQuestionId(v: GameVoteSession, voterId: string): string | null {
  for (const q of v.questions) {
    const rec = v.votesByQuestion.get(q.id);
    if (!rec || !rec.has(voterId)) return q.id;
  }
  return null;
}

function buildBallotEmbed(v: GameVoteSession, voterId: string, activeQuestionId: string): EmbedBuilder {
  const ends = Math.floor(v.endsAtMs / 1000);
  const header =
    v.status !== 'active'
      ? '**Voting has ended.**'
      : `Finish before <t:${ends}:R>. Use **◀ Back** and **Next ▶** to move between questions, then press **Finish Vote**.`;

  const lines = v.questions.map((q, idx) => {
    const rec = v.votesByQuestion.get(q.id);
    const pickId = rec?.get(voterId);
    const pick = pickId ? q.options.find((o) => o.id === pickId) : undefined;
    const pickLabel = pick ? `${pick.emoji ? `${pick.emoji} ` : ''}${pick.label}` : '—';
    const mark = pickId ? '✅' : '⬜';
    const cursor = q.id === activeQuestionId ? '➡️ ' : '';
    return `${cursor}${mark} ${idx + 1}. ${q.title} — ${pickLabel}`;
  });

  return new EmbedBuilder()
    .setTitle('🗳️ Vote Panel')
    .setDescription([header, '', lines.join('\n') || '—'].join('\n'));
}

function activeQuestionIndex(v: GameVoteSession, activeQuestionId: string): number {
  const idx = v.questions.findIndex((q) => q.id === activeQuestionId);
  return idx >= 0 ? idx : 0;
}

function questionIdByDelta(v: GameVoteSession, activeQuestionId: string, delta: -1 | 1): string {
  const idx = activeQuestionIndex(v, activeQuestionId);
  const next = Math.max(0, Math.min(v.questions.length - 1, idx + delta));
  return v.questions[next]?.id ?? activeQuestionId;
}

function nextQuestionIdAfterSelection(
  v: GameVoteSession,
  voterId: string,
  currentQuestionId: string
): string {
  const currentIndex = activeQuestionIndex(v, currentQuestionId);

  for (let i = currentIndex + 1; i < v.questions.length; i += 1) {
    const question = v.questions[i];
    if (!v.votesByQuestion.get(question.id)?.has(voterId)) return question.id;
  }

  const firstUnanswered = firstUnansweredQuestionId(v, voterId);
  if (firstUnanswered) return firstUnanswered;

  return questionIdByDelta(v, currentQuestionId, 1);
}

function buildBallotComponents(
  v: GameVoteSession,
  voterId: string,
  activeQuestionId: string
): readonly ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[] {
  const finished = v.finished.has(voterId);
  const total = v.questions.length;
  const answered = v.questions.reduce((acc, q) => (v.votesByQuestion.get(q.id)?.has(voterId) ? acc + 1 : acc), 0);
  const canFinish = !finished && answered >= total;

  const q = v.questions.find((qq) => qq.id === activeQuestionId) ?? v.questions[0];
  const currentPickId = v.votesByQuestion.get(q.id)?.get(voterId);
  const questionIndex = activeQuestionIndex(v, q.id);

  const optionSelect = new StringSelectMenuBuilder()
    .setCustomId(`gv:ballotv:${v.sessionId}`)
    .setPlaceholder(`${questionIndex + 1}. ${q.title}`.slice(0, 150))
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
    .setDisabled(finished || questionIndex <= 0);

  const nextBtn = new ButtonBuilder()
    .setCustomId(`gv:ballotnav:next:${v.sessionId}`)
    .setStyle(ButtonStyle.Secondary)
    .setLabel('Next ▶')
    .setDisabled(finished || questionIndex >= total - 1);

  const finishBtn = new ButtonBuilder()
    .setCustomId(`gv:finishvote:${v.sessionId}`)
    .setStyle(ButtonStyle.Success)
    .setLabel(finished ? 'Vote finished' : 'Finish Vote')
    .setDisabled(!canFinish);

  return [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(optionSelect),
    new ActionRowBuilder<ButtonBuilder>().addComponents(prevBtn, nextBtn, finishBtn),
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

function getAllowedCivBanKeys(v: GameVoteSession): string[] {
  if (v.edition !== 'CIV7') return [];

  return Object.entries(CIV7_CIVS)
    .filter(([, meta]) => v.startingAge === 'None' || !v.startingAge || meta.agePool === v.startingAge)
    .sort((a, b) => a[1].gameId.localeCompare(b[1].gameId))
    .map(([key]) => key);
}

function getBanSubmission(v: GameVoteSession, voterId: string): BanSubmission {
  const current = v.bansByVoter.get(voterId);
  return {
    leaderKeys: current?.leaderKeys ?? [],
    civKeys: current?.civKeys ?? [],
  };
}

function updatePagedSelection(
  existing: readonly string[],
  pageKeys: readonly string[],
  selectedValues: readonly string[]
): string[] {
  const pageSet = new Set(pageKeys);
  const selected = new Set(selectedValues.filter((value) => pageSet.has(value)));
  const next = existing.filter((value) => !pageSet.has(value));
  for (const key of pageKeys) {
    if (selected.has(key)) next.push(key);
  }
  return next;
}

function mapBanLabels(
  keys: readonly string[],
  source: Record<string, { gameId: string }>
): string[] {
  return keys.map((key) => source[key]?.gameId ?? key).filter(Boolean);
}

function buildWrappedBanFieldValues(labels: readonly string[]): string[] {
  if (labels.length === 0) return ['None selected'];

  const lineMax = 96;
  const fieldMax = 1024;
  const lines: string[] = [];
  let currentLine = '';

  for (const label of labels) {
    const nextLine = currentLine ? `${currentLine}, ${label}` : label;
    if (nextLine.length <= lineMax) {
      currentLine = nextLine;
      continue;
    }

    if (currentLine) lines.push(currentLine);
    currentLine = label;
  }

  if (currentLine) lines.push(currentLine);

  const chunks: string[] = [];
  let currentChunk = '';

  for (const line of lines) {
    const nextChunk = currentChunk ? `${currentChunk}\n${line}` : line;
    if (nextChunk.length <= fieldMax) {
      currentChunk = nextChunk;
      continue;
    }

    if (currentChunk) chunks.push(currentChunk);
    currentChunk = line;
  }

  if (currentChunk) chunks.push(currentChunk);

  return chunks;
}

function buildBansPanelEmbed(v: GameVoteSession, voterId: string): EmbedBuilder {
  const bans = getBanSubmission(v, voterId);
  const leaders = getLeaderBanSource(v);
  const civs = getCivBanSource(v);
  const submitted = v.bansSubmitted.has(voterId);

  const embed = new EmbedBuilder().setTitle('🛑 Bans').setDescription(
    submitted
      ? '✅ **Bans submitted**'
      : 'Choose one or more bans with the menus below, review them, then press **Submit Bans**.'
  );

  const leaderLabels = mapBanLabels(bans.leaderKeys, leaders);
  const leaderValues = buildWrappedBanFieldValues(leaderLabels);
  embed.addFields(
    ...leaderValues.map((value, index) => ({
      name: index === 0 ? `Leader bans (${leaderLabels.length})` : 'Leader bans (cont.)',
      value,
      inline: false,
    }))
  );

  if (civs) {
    const civLabels = mapBanLabels(bans.civKeys ?? [], civs);
    const civValues = buildWrappedBanFieldValues(civLabels);
    embed.addFields(
      ...civValues.map((value, index) => ({
        name: index === 0 ? `Civ bans (${civLabels.length})` : 'Civ bans (cont.)',
        value,
        inline: false,
      }))
    );
  }

  return embed;
}

function buildBansPanelComponents(
  v: GameVoteSession,
  voterId: string
): readonly ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[] {
  const submitted = v.bansSubmitted.has(voterId);
  const leaders = getLeaderBanSource(v);
  const civs = getCivBanSource(v);

  const leaderKeys = sortKeysByGameId(leaders);
  const civKeys = v.edition === 'CIV7' ? getAllowedCivBanKeys(v) : [];

  const page = getBanPageState(v, voterId);
  const leaderPages = Math.max(1, Math.ceil(leaderKeys.length / BAN_LEADER_PAGE_SIZE));
  const civPages = civs ? Math.max(1, Math.ceil(civKeys.length / BAN_CIV_PAGE_SIZE)) : 1;

  const leaderPage = Math.min(Math.max(page.leaderPage, 0), leaderPages - 1);
  const civPage = Math.min(Math.max(page.civPage, 0), civPages - 1);

  if (leaderPage !== page.leaderPage || civPage !== page.civPage) {
    setBanPageState(v, voterId, { leaderPage, civPage });
  }

  const bans = getBanSubmission(v, voterId);

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
      default: bans.leaderKeys.includes(key),
    };
  });

  const leaderMenu = new StringSelectMenuBuilder()
    .setCustomId(`gv:banpick:leader:${v.sessionId}`)
    .setPlaceholder(`Leader bans (page ${leaderPage + 1}/${leaderPages})`)
    .setMinValues(0)
    .setMaxValues(Math.max(1, leaderOptions.length))
    .setDisabled(submitted)
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
        default: (bans.civKeys ?? []).includes(key),
      };
    });

    const civMenu = new StringSelectMenuBuilder()
      .setCustomId(`gv:banpick:civ:${v.sessionId}`)
      .setPlaceholder(`Civ bans (page ${civPage + 1}/${civPages})`)
      .setMinValues(0)
      .setMaxValues(Math.max(1, civOptions.length))
      .setDisabled(submitted)
      .addOptions(civOptions);

    rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(civMenu));
  }

  const navRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`gv:bannav:leader:prev:${v.sessionId}`)
      .setStyle(ButtonStyle.Secondary)
      .setLabel('◀ Leader')
      .setDisabled(submitted || leaderPages <= 1),
    new ButtonBuilder()
      .setCustomId(`gv:bannav:leader:next:${v.sessionId}`)
      .setStyle(ButtonStyle.Secondary)
      .setLabel('Leader ▶')
      .setDisabled(submitted || leaderPages <= 1)
  );

  if (civs) {
    navRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`gv:bannav:civ:prev:${v.sessionId}`)
        .setStyle(ButtonStyle.Secondary)
        .setLabel('◀ Civ')
        .setDisabled(submitted || civPages <= 1),
      new ButtonBuilder()
        .setCustomId(`gv:bannav:civ:next:${v.sessionId}`)
        .setStyle(ButtonStyle.Secondary)
        .setLabel('Civ ▶')
        .setDisabled(submitted || civPages <= 1)
    );
  }

  navRow.addComponents(
    new ButtonBuilder()
      .setCustomId(`gv:bansubmit:${v.sessionId}`)
      .setStyle(ButtonStyle.Success)
      .setLabel('Submit Bans')
      .setDisabled(submitted)
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
  const nowMs = Date.now();
  const progress = buildProgress(v);
  const questionFields = buildQuestionFields(v);

  const embed = buildGameVoteEmbed({
    edition: v.edition,
    gameType: v.gameType,
    startingAge: v.startingAge,
    phase: v.phase,
    status: v.status,
    nowMs,
    startedAtMs: v.startedAtMs,
    autoCloseAtMs: v.startedAtMs + VOTE_DURATION_MS,
    progress,
    questionFields,
  });

  const components: readonly ActionRowBuilder<ButtonBuilder>[] =
    v.status === 'active' && v.phase === 'voting'
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

  const winnerId = pickRandom(tied);
  tiebrokenQuestions.add(question.id);

  console.info('[gamevote] tiebreak', {
    sessionId,
    questionId: question.id,
    tied,
    winnerId,
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


async function openInitialMessages(
  v: GameVoteSession,
  guild: Guild
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const msg = await v.commandChannel.send(buildRenderPayload(v));
    if (!msg.inGuild()) return { ok: false, message: '⚠️ This command must be used in a server channel.' };
    if (msg.guildId !== guild.id) return { ok: false, message: '⚠️ Internal error: guild mismatch.' };
    v.publicMessage = msg;
    return { ok: true };
  } catch (err: unknown) {
    const code = typeof err === 'object' && err && 'code' in err ? (err as any).code : undefined;
    const extra = code ? ` (Discord error ${code})` : '';
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
    if (v.edition === 'CIV7' && (bans.civKeys?.length ?? 0) > 0) civPerVoter.set(id, new Set(bans.civKeys));
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
    if (v.edition === 'CIV7' && (bans.civKeys?.length ?? 0) > 0) civPerVoter.set(id, new Set(bans.civKeys));
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
    v.status = 'completed';
    v.isFinalized = true;
    v.phase = 'final';
    v.endsAtMs = Date.now();
    await safeEditMessage(v.publicMessage, buildRenderPayload(v));
    await publishDraftResult(v);
    await finalizeCleanup(v);
    return;
  }

  v.status = 'completed';
  v.phase = 'blind_draft';
  v.blindDraftEndsAtMs = Date.now() + BLIND_DRAFT_DURATION_MS;
  v.endsAtMs = Date.now();

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

  v.status = 'completed';
  v.phase = 'final';
  v.isFinalized = true;

  await safeEditMessage(v.publicMessage, { components: [] });
  await forEachLimit([...v.dmMessages.values()], DM_CONCURRENCY, async (m) => {
    await safeEditMessage(m, { components: [] });
  });

  await finalizeCleanup(v);
}

async function completeVote(v: GameVoteSession): Promise<void> {
  if (v.isFinalized) return;
  if (v.phase !== 'voting') return;

  if (v.timeout) {
    clearTimeout(v.timeout);
    v.timeout = null;
  }

  ensureLockedAll(v);

  if (getDraftMode(v) === 'blind') {
    await startBlindDraft(v);
    return;
  }

  v.status = 'completed';
  v.isFinalized = true;
  v.phase = 'final';
  v.endsAtMs = Date.now();

  await safeEditMessage(v.publicMessage, buildRenderPayload(v));
  await publishDraftResult(v);
  await finalizeCleanup(v);
}

async function endVoting(v: GameVoteSession, reason: 'timeout' | 'complete'): Promise<void> {
  if (reason === 'complete') {
    await completeVote(v);
    return;
  }

  if (v.phase !== 'voting') return;

  if (v.timeout) {
    clearTimeout(v.timeout);
    v.timeout = null;
  }

  ensureLockedAll(v);
  v.status = 'timed_out';
  v.phase = 'final';
  v.isFinalized = true;
  v.endsAtMs = Date.now();

  await safeEditMessage(v.publicMessage, buildRenderPayload(v));
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
      status: 'active',
      questions,

      votesByQuestion: new Map(),
      lockedSettings: new Map(),
      tiebrokenQuestions: new Set(),
      activeQuestionByVoter: new Map(),

      bansByVoter: new Map(),
      bansSubmitted: new Set(),
      banPages: new Map(),
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

    v.timeout = setTimeout(() => void endVoting(v, 'timeout'), VOTE_DURATION_MS);

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
  | Readonly<{ action: 'ballot' | 'ballotv' | 'finishvote' | 'ban' | 'bansubmit'; sessionId: string }>
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
    if (v.phase !== 'voting' || v.status !== 'active') { await replyNotice(interaction, '⚠️ Bans are closed.'); return true; }
    if (!isVoter(v, userId)) { await replyNotice(interaction, '⚠️ You are not part of this vote session.'); return true; }
    if (v.bansSubmitted.has(userId)) { await replyNotice(interaction, '⚠️ You already submitted your bans.'); return true; }

    const current = getBanSubmission(v, userId);
    const page = getBanPageState(v, userId);

    if (parsed.banType === 'leader') {
      const leaderKeys = sortKeysByGameId(getLeaderBanSource(v));
      const pageKeys = leaderKeys.slice(
        page.leaderPage * BAN_LEADER_PAGE_SIZE,
        page.leaderPage * BAN_LEADER_PAGE_SIZE + BAN_LEADER_PAGE_SIZE
      );
      v.bansByVoter.set(userId, {
        leaderKeys: updatePagedSelection(current.leaderKeys, pageKeys, interaction.values),
        civKeys: current.civKeys ?? [],
      });
    } else {
      if (v.edition !== 'CIV7') { await replyNotice(interaction, '⚠️ Civ bans are not available for Civ6.'); return true; }
      const civKeys = getAllowedCivBanKeys(v);
      const pageKeys = civKeys.slice(
        page.civPage * BAN_CIV_PAGE_SIZE,
        page.civPage * BAN_CIV_PAGE_SIZE + BAN_CIV_PAGE_SIZE
      );
      v.bansByVoter.set(userId, {
        leaderKeys: current.leaderKeys,
        civKeys: updatePagedSelection(current.civKeys ?? [], pageKeys, interaction.values),
      });
    }

    const payload = buildBansPanelPayload(v, userId);
    await interaction.update({ embeds: payload.embeds, components: payload.components });
    return true;
  }

  // Vote panel selects (guild-only)
  if (!interaction.inCachedGuild()) return true;

  if (parsed.action !== 'ballotv') return true;

  if (v.phase !== 'voting' || v.status !== 'active') { await replyNotice(interaction, '⚠️ Voting has ended.'); return true; }
  if (!isVoter(v, userId)) { await replyNotice(interaction, '⚠️ You are not part of this vote session.'); return true; }
  if (v.finished.has(userId)) { await replyNotice(interaction, '⚠️ You already finished your vote.'); return true; }

  const activeFromState =
    v.activeQuestionByVoter.get(userId) ?? firstUnansweredQuestionId(v, userId) ?? v.questions[0]?.id;

  if (!activeFromState) { await replyNotice(interaction, '⚠️ No questions available.'); return true; }

  const qid = activeFromState;
  const q = v.questions.find((qq) => qq.id === qid);
  if (!q) { await replyNotice(interaction, '⚠️ Invalid question context.'); return true; }

  const optId = interaction.values[0];
  if (!q.options.some((o) => o.id === optId)) { await replyNotice(interaction, '⚠️ Invalid option selection.'); return true; }

  const rec = v.votesByQuestion.get(qid) ?? new Map<string, string>();
  const wasAnswered = rec.has(userId);
  rec.set(userId, optId);
  v.votesByQuestion.set(qid, rec);

  if (!wasAnswered) {
    await safeEditMessage(v.publicMessage, buildRenderPayload(v));
  }

  const nextQuestionId = nextQuestionIdAfterSelection(v, userId, qid);
  v.activeQuestionByVoter.set(userId, nextQuestionId);

  const active = v.activeQuestionByVoter.get(userId) ?? nextQuestionId;
  const embed = buildBallotEmbed(v, userId, active);
  const components = buildBallotComponents(v, userId, active);

  await interaction.update({ embeds: [embed], components: [...components] });
  return true;
}

export async function handleGameVoteButton(interaction: ButtonInteraction): Promise<boolean> {
  const parsed = parseCustomId(interaction.customId);
  if (!parsed) return false;

  const v = getSessionById(parsed.sessionId);
  if (!v) { await replyNotice(interaction, '⚠️ This vote session has ended or is invalid.'); return true; }

  const userId = interaction.user.id;

  if (parsed.action === 'ballot') {
    if (v.phase !== 'voting' || v.status !== 'active') { await replyNotice(interaction, '⚠️ Voting has ended.'); return true; }
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

  if (parsed.action === 'finishvote') {
    if (v.phase !== 'voting' || v.status !== 'active') { await replyNotice(interaction, '⚠️ Voting has ended.'); return true; }
    if (!isVoter(v, userId)) { await replyNotice(interaction, '⚠️ You are not part of this vote session.'); return true; }
    if (v.finished.has(userId)) { await replyNotice(interaction, '⚠️ You already finished your vote.'); return true; }

    const missing = firstUnansweredQuestionId(v, userId);
    if (missing) { await replyNotice(interaction, '⚠️ Answer all questions before finishing your vote.'); return true; }

    v.finished.add(userId);

    const allFinished = v.voterIds.every((id) => v.finished.has(id));
    if (allFinished) {
      await completeVote(v);
    } else {
      await safeEditMessage(v.publicMessage, buildRenderPayload(v));
    }

    const active =
      v.activeQuestionByVoter.get(userId) ?? firstUnansweredQuestionId(v, userId) ?? v.questions[0]?.id;

    const embed = active ? buildBallotEmbed(v, userId, active) : new EmbedBuilder().setDescription('Vote finished.');
    const components = active ? buildBallotComponents(v, userId, active) : [];

    // If this button came from the ephemeral vote panel, prefer update. Otherwise, reply ephemerally.
    try {
      await interaction.update({ embeds: [embed], components: [...components] });
    } catch {
      await replySafe(interaction, { embeds: [embed], components: [...components], flags: MessageFlags.Ephemeral });
    }

    return true;
  }


  if (parsed.action === 'ban') {
    if (v.phase !== 'voting' || v.status !== 'active') { await replyNotice(interaction, '⚠️ Bans are closed.'); return true; }
    if (!isVoter(v, userId)) { await replyNotice(interaction, '⚠️ You are not part of this vote session.'); return true; }

    await replySafe(interaction, buildBansPanelPayload(v, userId));
    return true;
  }

  if (parsed.action === 'bannav') {
    if (v.phase !== 'voting' || v.status !== 'active') { await replyNotice(interaction, '⚠️ Bans are closed.'); return true; }
    if (!isVoter(v, userId)) { await replyNotice(interaction, '⚠️ You are not part of this vote session.'); return true; }
    if (v.bansSubmitted.has(userId)) { await replyNotice(interaction, '⚠️ You already submitted your bans.'); return true; }

    const page = getBanPageState(v, userId);
    const leaders = getLeaderBanSource(v);
    const civs = getCivBanSource(v);

    const leaderKeys = sortKeysByGameId(leaders);
    const civKeys = civs ? getAllowedCivBanKeys(v) : [];

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
    if (v.phase !== 'voting' || v.status !== 'active') { await replyNotice(interaction, '⚠️ Bans are closed.'); return true; }
    if (!isVoter(v, userId)) { await replyNotice(interaction, '⚠️ You are not part of this vote session.'); return true; }
    if (v.bansSubmitted.has(userId)) { await replyNotice(interaction, '⚠️ You already submitted your bans.'); return true; }

    const bans = getBanSubmission(v, userId);
    if (bans.leaderKeys.length === 0 && (bans.civKeys?.length ?? 0) === 0) { await replyNotice(interaction, '⚠️ Pick at least one ban before submitting.'); return true; }

    v.bansSubmitted.add(userId);

    // Update the public message progress.
    await safeEditMessage(v.publicMessage, buildRenderPayload(v));

    const payload = buildBansPanelPayload(v, userId);
    await interaction.update({ embeds: payload.embeds, components: payload.components });

    return true;
  }

  if (parsed.action === 'ballotnav') {
    if (v.phase !== 'voting' || v.status !== 'active') { await replyNotice(interaction, '⚠️ Voting has ended.'); return true; }
    if (!isVoter(v, userId)) { await replyNotice(interaction, '⚠️ You are not part of this vote session.'); return true; }
    if (v.finished.has(userId)) { await replyNotice(interaction, '⚠️ You already finished your vote.'); return true; }

    const active =
      v.activeQuestionByVoter.get(userId) ?? firstUnansweredQuestionId(v, userId) ?? v.questions[0]?.id;

    if (!active) { await replyNotice(interaction, '⚠️ No questions available.'); return true; }

    const nextQuestionId = questionIdByDelta(v, active, parsed.navDir === 'next' ? 1 : -1);
    v.activeQuestionByVoter.set(userId, nextQuestionId);

    const embed = buildBallotEmbed(v, userId, nextQuestionId);
    const components = buildBallotComponents(v, userId, nextQuestionId);

    try {
      await interaction.update({ embeds: [embed], components: [...components] });
    } catch {
      await replySafe(interaction, { embeds: [embed], components: [...components], flags: MessageFlags.Ephemeral });
    }

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
