import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
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
import type { CivMeta, LeaderMeta } from '../data/types.js';
import { CIV6_LEADERS } from '../data/civ6-data.js';
import { CIV7_CIVS, CIV7_LEADERS } from '../data/civ7-data.js';
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
} from '../types/gamevote.js';

const VOTE_DURATION_MS = 10 * 60_000;
const BLIND_DRAFT_DURATION_MS = 10 * 60_000;

const DM_CONCURRENCY = 8;
const BLIND_MENU_PAGE_SIZE = 25;

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
    voters: v.voters,
    totalQuestions: v.questions.length,
    answeredCountById: answered,
    bansSubmittedIds: new Set(v.bansSubmitted),
    finishedIds: new Set(v.finished),
    blindDraftPickedIds: blindPicked,
  };
}


type RenderPayload = Omit<MessageCreateOptions, 'flags'> & Omit<MessageEditOptions, 'flags'>;

function buildQuestionFields(v: GameVoteSession): readonly { name: string; value: string }[] {
  const showWinners = v.phase !== 'voting';
  return v.questions.map((q, idx) => {
    const name = `${idx + 1}. ${q.title}`;

    if (showWinners) {
      const winnerId = v.lockedSettings.get(q.id) ?? q.defaultOptionId;
      const winner = q.options.find((o) => o.id === winnerId);
      const label = winner ? `${winner.emoji ? `${winner.emoji} ` : ''}${winner.label}` : winnerId;
      const tb = v.tiebrokenQuestions.has(q.id) ? ' *(tiebreak)*' : '';
      return { name, value: `✅ **${label}**${tb}` };
    }

    const lines = q.options.map((o) => `• ${o.emoji ? `${o.emoji} ` : ''}${o.label}`);
    return { name, value: lines.join('\n') || '—' };
  });
}

function buildVotingButtons(v: GameVoteSession): readonly ActionRowBuilder<ButtonBuilder>[] {
  const voteBtn = new ButtonBuilder()
    .setCustomId(`gv:ballot:${v.sessionId}`)
    .setStyle(ButtonStyle.Primary)
    .setLabel('Vote');

  return [new ActionRowBuilder<ButtonBuilder>().addComponents(voteBtn)];
}

function buildBansButtons(v: GameVoteSession): readonly ActionRowBuilder<ButtonBuilder>[] {
  const banBtn = new ButtonBuilder()
    .setCustomId(`gv:ban:${v.sessionId}`)
    .setStyle(ButtonStyle.Secondary)
    .setLabel('Submit bans');

  const finalizeBtn = new ButtonBuilder()
    .setCustomId(`gv:finalize:${v.sessionId}`)
    .setStyle(ButtonStyle.Primary)
    .setLabel('Finalize');

  return [new ActionRowBuilder<ButtonBuilder>().addComponents(banBtn, finalizeBtn)];
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
    v.endsAtMs <= Date.now()
      ? '**Voting has ended.**'
      : `Finish before <t:${ends}:R>. Answer all questions, then press **Finish Vote**.`;

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

function buildBallotComponents(
  v: GameVoteSession,
  voterId: string,
  activeQuestionId: string
): readonly ActionRowBuilder<any>[] {
  const finished = v.finished.has(voterId);
  const total = v.questions.length;
  const answered = v.questions.reduce((acc, q) => (v.votesByQuestion.get(q.id)?.has(voterId) ? acc + 1 : acc), 0);
  const canFinish = !finished && answered >= total;

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

  const q = v.questions.find((qq) => qq.id === activeQuestionId) ?? v.questions[0];
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

  const finishBtn = new ButtonBuilder()
    .setCustomId(`gv:finishvote:${v.sessionId}`)
    .setStyle(ButtonStyle.Success)
    .setLabel(finished ? 'Vote finished' : 'Finish Vote')
    .setDisabled(!canFinish);

  return [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(questionSelect),
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(optionSelect),
    new ActionRowBuilder<ButtonBuilder>().addComponents(finishBtn),
  ];
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
    nowMs,
    endsAtMs: v.endsAtMs,
    progress,
    questionFields,
  });

  let components: readonly ActionRowBuilder<any>[] = [];
  if (v.phase === 'voting') {
    components = buildVotingButtons(v);
  } else if (v.phase === 'bans') {
    components = buildBansButtons(v);
  }

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



const EMOJI_MENTION_RE = /^<a?:([A-Za-z0-9_]{2,32}):(\d{15,22})>$/;
const EMOJI_COLON_RE = /^:([A-Za-z0-9_]{2,32}):$/;
const SNOWFLAKE_RE = /^\d{15,22}$/;

function tokenizeBans(raw: string): string[] {
  return raw
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function buildIndex<K extends string>(
  entries: Readonly<Record<K, LeaderMeta | CivMeta>>
): ReadonlyMap<string, K> {
  const map = new Map<string, K>();
  for (const [key, meta] of Object.entries(entries) as [K, LeaderMeta | CivMeta][]) {
    map.set(key.toLowerCase(), key);
    map.set(meta.gameId.toLowerCase(), key);
    const emojiId = meta.emojiId?.trim();
    if (emojiId && SNOWFLAKE_RE.test(emojiId)) map.set(emojiId, key);
  }
  return map;
}

function resolveEmojiTokensToKeys<K extends string>(
  tokens: readonly string[],
  index: ReadonlyMap<string, K>
): ReadonlySet<K> {
  const out = new Set<K>();
  for (const raw of tokens) {
    const mention = EMOJI_MENTION_RE.exec(raw);
    const colon = EMOJI_COLON_RE.exec(raw);
    const name = mention?.[1] ?? colon?.[1] ?? null;
    const id = mention?.[2] ?? null;
    if (!name) continue;
    const key = index.get(name.toLowerCase()) ?? (id ? index.get(id) : undefined);
    if (key) out.add(key);
  }
  return out;
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

function keysToColonTokens<K extends string>(
  keys: readonly K[],
  lookup: (k: K) => Readonly<{ gameId: string }> | undefined
): string {
  const parts: string[] = [];
  for (const k of keys) {
    const meta = lookup(k);
    if (!meta) continue;
    parts.push(`:${meta.gameId}:`);
  }
  return parts.join(',');
}

function civ6LeaderMeta(k: string): Readonly<{ gameId: string }> | undefined {
  return (CIV6_LEADERS as Record<string, LeaderMeta>)[k];
}

function civ7LeaderMeta(k: string): Readonly<{ gameId: string }> | undefined {
  return (CIV7_LEADERS as Record<string, LeaderMeta>)[k];
}

function civ7CivMeta(k: string): Readonly<{ gameId: string }> | undefined {
  return (CIV7_CIVS as Record<string, CivMeta>)[k];
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
  const leaderIndex =
    v.edition === 'CIV6'
      ? buildIndex(CIV6_LEADERS)
      : buildIndex(CIV7_LEADERS);
  const civIndex = v.edition === 'CIV7' ? buildIndex(CIV7_CIVS) : null;

  const leaderPerVoter = new Map<string, ReadonlySet<string>>();
  const civPerVoter = new Map<string, ReadonlySet<string>>();
  for (const id of v.voterIds) {
    const bans = v.bansByVoter.get(id);
    if (!bans) continue;
    const leaderKeys = resolveEmojiTokensToKeys(tokenizeBans(bans.leaderRaw), leaderIndex);
    leaderPerVoter.set(id, leaderKeys);
    if (v.edition === 'CIV7' && bans.civRaw && civIndex) {
      const civKeys = resolveEmojiTokensToKeys(tokenizeBans(bans.civRaw), civIndex);
      civPerVoter.set(id, civKeys);
    }
  }

  const bannedLeaderKeys = majorityBans(v.voterIds, leaderPerVoter);
  const bannedCivKeys = v.edition === 'CIV7' ? majorityBans(v.voterIds, civPerVoter) : [];

  const leaderBansRaw =
    v.edition === 'CIV6'
      ? keysToColonTokens(bannedLeaderKeys, civ6LeaderMeta)
      : keysToColonTokens(bannedLeaderKeys, civ7LeaderMeta);
  const civBansRaw = v.edition === 'CIV7'
    ? keysToColonTokens(bannedCivKeys, civ7CivMeta)
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
  const leaderIndex = v.edition === 'CIV6' ? buildIndex(CIV6_LEADERS) : buildIndex(CIV7_LEADERS);
  const civIndex = v.edition === 'CIV7' ? buildIndex(CIV7_CIVS) : null;

  const leaderPerVoter = new Map<string, ReadonlySet<string>>();
  const civPerVoter = new Map<string, ReadonlySet<string>>();
  for (const id of v.voterIds) {
    const bans = v.bansByVoter.get(id);
    if (!bans) continue;
    leaderPerVoter.set(id, resolveEmojiTokensToKeys(tokenizeBans(bans.leaderRaw), leaderIndex));
    if (v.edition === 'CIV7' && bans.civRaw && civIndex) {
      civPerVoter.set(id, resolveEmojiTokensToKeys(tokenizeBans(bans.civRaw), civIndex));
    }
  }
  const bannedLeaderKeys = majorityBans(v.voterIds, leaderPerVoter);
  const bannedCivKeys = v.edition === 'CIV7' ? majorityBans(v.voterIds, civPerVoter) : [];

  const leaderBansRaw =
    v.edition === 'CIV6'
      ? keysToColonTokens(bannedLeaderKeys, civ6LeaderMeta)
      : keysToColonTokens(bannedLeaderKeys, civ7LeaderMeta);
  const civBansRaw = v.edition === 'CIV7'
    ? keysToColonTokens(bannedCivKeys, civ7CivMeta)
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
  v.endsAtMs = Date.now();
    await safeEditMessage(v.publicMessage, buildRenderPayload(v));
    await publishDraftResult(v);
    await finalizeCleanup(v);
    return;
  }

  v.phase = 'blind_draft';
  v.blindDraftEndsAtMs = Date.now() + BLIND_DRAFT_DURATION_MS;
  v.endsAtMs = v.blindDraftEndsAtMs;

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
  v.isFinalized = true;

  await safeEditMessage(v.publicMessage, { components: [] });
  await forEachLimit([...v.dmMessages.values()], DM_CONCURRENCY, async (m) => {
    await safeEditMessage(m, { components: [] });
  });

  await finalizeCleanup(v);
}

async function endVoting(v: GameVoteSession, reason: 'timeout' | 'complete'): Promise<void> {
  if (v.phase !== 'voting') return;

  if (v.timeout) {
    clearTimeout(v.timeout);
    v.timeout = null;
  }

  ensureLockedAll(v);
  v.phase = 'bans';
  v.endsAtMs = Date.now();

  await safeEditMessage(v.publicMessage, buildRenderPayload(v));

  if (reason === 'timeout') {
    // Some voters may not have finished; defaults are applied where needed.
    return;
  }
}

function canFinalizeBans(v: GameVoteSession, userId: string): boolean {
  return userId === v.hostId || v.bansSubmitted.size >= v.voterIds.length;
}

async function finalizeAfterBans(v: GameVoteSession): Promise<void> {
  if (v.isFinalized) return;
  if (v.phase !== 'bans') return;

  if (v.blindMode) {
    await startBlindDraft(v);
    return;
  }

  v.isFinalized = true;
  v.phase = 'final';
  v.endsAtMs = Date.now();

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

        const { questions } = buildGameVoteConfig({ gameType: args.gameType, blindMode: args.blindMode });

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
      blindMode: args.blindMode,

      voters,
      voterIds,
      voterUsersById,

      startedAtMs: now,
      endsAtMs: now + VOTE_DURATION_MS,

      phase: 'voting',
      questions,

      votesByQuestion: new Map(),
      lockedSettings: new Map(),
      tiebrokenQuestions: new Set(),
      activeQuestionByVoter: new Map(),

      bansByVoter: new Map(),
      bansSubmitted: new Set(),
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
  | Readonly<{ action: 'ballot' | 'ballotq' | 'ballotv' | 'finishvote' | 'ban' | 'finalize'; sessionId: string }>
  | Readonly<{ action: 'pick'; pickType: 'civ' | 'leader'; sessionId: string }>
  | Readonly<{ action: 'nav'; pickType: 'civ' | 'leader'; navDir: 'prev' | 'next'; sessionId: string }>;

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

  // gv:<action>:<sessionId>
  const sessionId = parts[2];
  if (!sessionId) return null;

  if (
    action === 'ballot' ||
    action === 'ballotq' ||
    action === 'ballotv' ||
    action === 'finishvote' ||
    action === 'ban' ||
    action === 'finalize'
  ) {
    return { action, sessionId };
  }

  return null;
}



function getSession(customId: string): GameVoteSession | null {
  const parsed = parseCustomId(customId);
  if (!parsed) return null;
  return activeById.get(parsed.sessionId) ?? null;
}

function isVoter(v: GameVoteSession, userId: string): boolean {
  return v.voterIds.includes(userId);
}

export async function handleGameVoteSelect(interaction: StringSelectMenuInteraction): Promise<boolean> {
  const parsed = parseCustomId(interaction.customId);
  if (!parsed) return false;

  const v = getSession(parsed.sessionId);
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

  // Vote panel selects (guild-only)
  if (!interaction.inCachedGuild()) return true;

  if (parsed.action !== 'ballotq' && parsed.action !== 'ballotv') return true;

  if (v.phase !== 'voting') { await replyNotice(interaction, '⚠️ Voting has ended.'); return true; }
  if (!isVoter(v, userId)) { await replyNotice(interaction, '⚠️ You are not part of this vote session.'); return true; }
  if (v.finished.has(userId)) { await replyNotice(interaction, '⚠️ You already finished your vote.'); return true; }

  const activeFromState =
    v.activeQuestionByVoter.get(userId) ?? firstUnansweredQuestionId(v, userId) ?? v.questions[0]?.id;

  if (!activeFromState) { await replyNotice(interaction, '⚠️ No questions available.'); return true; }

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
    rec.set(userId, optId);
    v.votesByQuestion.set(qid, rec);

    v.activeQuestionByVoter.set(userId, qid);
  }

  const active = v.activeQuestionByVoter.get(userId) ?? activeFromState;
  const embed = buildBallotEmbed(v, userId, active);
  const components = buildBallotComponents(v, userId, active);

  await interaction.update({ embeds: [embed], components: [...components] });
  return true;
}




export async function handleGameVoteButton(interaction: ButtonInteraction): Promise<boolean> {
  const parsed = parseCustomId(interaction.customId);
  if (!parsed) return false;

  const v = getSession(parsed.sessionId);
  if (!v) { await replyNotice(interaction, '⚠️ This vote session has ended or is invalid.'); return true; }

  const userId = interaction.user.id;

  if (parsed.action === 'ballot') {
    if (v.phase !== 'voting') { await replyNotice(interaction, '⚠️ Voting has ended.'); return true; }
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
    if (v.phase !== 'voting') { await replyNotice(interaction, '⚠️ Voting has ended.'); return true; }
    if (!isVoter(v, userId)) { await replyNotice(interaction, '⚠️ You are not part of this vote session.'); return true; }
    if (v.finished.has(userId)) { await replyNotice(interaction, '⚠️ You already finished your vote.'); return true; }

    const missing = firstUnansweredQuestionId(v, userId);
    if (missing) { await replyNotice(interaction, '⚠️ Answer all questions before finishing your vote.'); return true; }

    v.finished.add(userId);

    const allFinished = v.voterIds.every((id) => v.finished.has(id));
    if (allFinished) {
      await endVoting(v, 'complete');
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
    if (!interaction.inCachedGuild()) return true;
    if (v.phase !== 'bans') { await replyNotice(interaction, '⚠️ Bans are not active.'); return true; }
    if (!isVoter(v, userId)) { await replyNotice(interaction, '⚠️ You are not part of this vote session.'); return true; }

    const previous = v.bansByVoter.get(userId);

    const leaderInput = new TextInputBuilder()
      .setCustomId('leader')
      .setLabel('Leader ban (required)')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setPlaceholder('Example: Cleopatra, Hammurabi')
      .setMaxLength(200)
      .setValue(previous?.leaderRaw ?? '');

    const civInput = new TextInputBuilder()
      .setCustomId('civ')
      .setLabel('Civ ban (optional)')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setPlaceholder('Example: Rome, Babylon')
      .setMaxLength(200)
      .setValue(previous?.civRaw ?? '');

    const modal = new ModalBuilder()
      .setCustomId(`gv:banmodal:${v.sessionId}`)
      .setTitle('Submit bans')
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(leaderInput),
        new ActionRowBuilder<TextInputBuilder>().addComponents(civInput)
      );

    await interaction.showModal(modal);
    return true;
  }

  if (parsed.action === 'finalize') {
    if (!interaction.inCachedGuild()) return true;
    if (v.phase !== 'bans') { await replyNotice(interaction, '⚠️ Finalize is only available during bans.'); return true; }
    if (!isVoter(v, userId) && userId !== v.hostId) { await replyNotice(interaction, '⚠️ You are not part of this session.'); return true; }

    if (!canFinalizeBans(v, userId)) {
      { await replyNotice(interaction, '⚠️ Waiting for all bans to be submitted (host can finalize early).'); return true; }
    }

    await replySafe(interaction, { content: 'Finalizing…', flags: MessageFlags.Ephemeral });

    await finalizeAfterBans(v);
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
  const parts = interaction.customId.split(':');
  if (parts[0] !== 'gv' || parts[1] !== 'banmodal') return false;

  const sessionId = parts[2];
  if (!sessionId) return false;

  const v = getSession(sessionId);
  if (!v) {
    await replyNotice(interaction, `${EMOJI_FAIL} This vote session is no longer active.`);
    return true;
  }

  const userId = interaction.user.id;

  if (!isVoter(v, userId)) {
    await replyNotice(interaction, `${EMOJI_FAIL} You are not a voter in this session.`);
    return true;
  }

  if (v.phase !== 'bans') {
    await replyNotice(interaction, `${EMOJI_FAIL} Bans are not active right now.`);
    return true;
  }

  const leaderRaw = interaction.fields.getTextInputValue('leader')?.trim() ?? '';
  const civRaw = interaction.fields.getTextInputValue('civ')?.trim() ?? '';

  v.bansByVoter.set(userId, { leaderRaw, civRaw: civRaw || undefined });
  v.bansSubmitted.add(userId);

  await replyNotice(interaction, '✅ Bans submitted.');

  await safeEditMessage(v.publicMessage, buildRenderPayload(v));
  return true;
}
