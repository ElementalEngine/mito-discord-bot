import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionsBitField,
  type ButtonInteraction,
  type Guild,
  type GuildMember,
  type InteractionReplyOptions,
  type MessageEditOptions,
  type ModalSubmitInteraction,
  type Message,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { randomInt, randomUUID } from 'node:crypto';

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
  GameVotePhase,
  GameVoteProgress,
  GameVoteSessionSeed,
  GameVoteVoter,
  StartGameVoteOptions,
  StartGameVoteResult,
  VoteRecord,
} from '../types/gamevote.js';
import type { VoterUser } from '../utils/types.js';

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

function renderLockedSettings(v: GameVoteSession): string[] {
  const lines: string[] = [];
  for (const q of v.questions) {
    const optId = v.lockedSettings.get(q.id);
    if (!optId) continue;
    const opt = q.options.find((o: VoteQuestion['options'][number]) => o.id === optId);
    if (!opt) continue;
    const emoji = opt.emoji ? `${opt.emoji} ` : '';
    lines.push(`• **${q.title}:** ${emoji}${opt.label}`);
  }

  return lines;
}

function currentQuestion(v: GameVoteSession): VoteQuestion | null {
  if (v.phase !== 'voting') return null;
  if (v.questionIndex < 0 || v.questionIndex >= v.questions.length) return null;
  return v.questions[v.questionIndex];
}

function buildVoteSelect(v: GameVoteSession, q: VoteQuestion): ActionRowBuilder<StringSelectMenuBuilder> {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`gv:vote:${v.sessionId}`)
    .setPlaceholder(`Pick: ${q.title}`)
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      q.options.map((o) => ({
        label: o.label,
        value: o.id,
        emoji: o.emoji,
      }))
    );

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

function buildBansButtons(v: GameVoteSession): ActionRowBuilder<ButtonBuilder>[] {
  const ban = new ButtonBuilder()
    .setCustomId(`gv:ban:${v.sessionId}`)
    .setLabel('Submit bans')
    .setStyle(ButtonStyle.Secondary);

  const finish = new ButtonBuilder()
    .setCustomId(`gv:finish:${v.sessionId}`)
    .setLabel('Finish vote')
    .setStyle(ButtonStyle.Success);

  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(ban, finish),
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

function buildRenderPayload(v: GameVoteSession): Readonly<{
  embeds: [ReturnType<typeof buildGameVoteEmbed>];
  components: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[];
}> {
  const now = Date.now();
  const q = currentQuestion(v);

  const embed = buildGameVoteEmbed({
    edition: v.edition,
    gameType: v.gameType,
    startingAge: v.startingAge,
    phase: v.phase,
    nowMs: now,
    endsAtMs: v.phase === 'blind_draft' && v.blindDraftEndsAtMs ? v.blindDraftEndsAtMs : v.endsAtMs,
    currentQuestion: q,
    questionIndex: v.questionIndex,
    totalQuestions: v.questions.length,
    settingsLines: renderLockedSettings(v),
    progress: buildProgress(v),
  });

  if (v.phase === 'voting' && q) {
    return { embeds: [embed], components: [buildVoteSelect(v, q)] };
  }

  if (v.phase === 'bans') {
    return { embeds: [embed], components: buildBansButtons(v) };
  }

  // blind draft uses DMs for picks; public message should be status-only.
  return { embeds: [embed], components: [] };
}

async function safeEditMessage(
  msg: Message,
  payload: MessageEditOptions
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

async function broadcastDMs(v: GameVoteSession, payload?: ReturnType<typeof buildRenderPayload>): Promise<void> {
  if (!v.blindMode) return;
  const p = payload ?? buildRenderPayload(v);
  const messages = [...v.dmMessages.values()];
  await forEachLimit(messages, DM_CONCURRENCY, async (m) => {
    await safeEditMessage(m, p);
  });
}

function selectWinner(q: VoteQuestion, record: VoteRecord, voterIds: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const id of voterIds) {
    const opt = record.get(id);
    if (!opt) continue;
    counts.set(opt, (counts.get(opt) ?? 0) + 1);
  }

  const need = majorityThreshold(voterIds.length);
  for (const [opt, count] of counts) {
    if (count >= need) return opt;
  }

  // If everyone voted: plurality (tie -> default)
  if (record.size >= voterIds.length) {
    let best = q.defaultOptionId;
    let bestCount = -1;
    for (const [opt, count] of counts) {
      if (count > bestCount) {
        best = opt;
        bestCount = count;
      } else if (count === bestCount) {
        // tie -> default
        best = q.defaultOptionId;
      }
    }
    return best;
  }

  // Not enough votes: default.
  return q.defaultOptionId;
}

function lockCurrentQuestionIfReady(v: GameVoteSession): boolean {
  const q = currentQuestion(v);
  if (!q) return false;
  if (v.lockedSettings.has(q.id)) return false;

  const rec = v.votesByQuestion.get(q.id) ?? new Map();
  const winner = selectWinner(q, rec, v.voterIds);

  // Lock if majority was reached OR everyone voted.
  const winnerCount = [...rec.values()].filter((x) => x === winner).length;
  const need = majorityThreshold(v.voterIds.length);
  const everyoneVoted = rec.size >= v.voterIds.length;
  if (winnerCount < need && !everyoneVoted) return false;

  v.lockedSettings.set(q.id, winner);
  v.questionIndex++;

  if (v.questionIndex >= v.questions.length) {
    v.phase = 'bans';
  }

  return true;
}

function ensureLockedAll(v: GameVoteSession): void {
  for (let i = 0; i < v.questions.length; i++) {
    const q = v.questions[i];
    if (v.lockedSettings.has(q.id)) continue;
    const rec = v.votesByQuestion.get(q.id) ?? new Map();
    const winner = selectWinner(q, rec, v.voterIds);
    v.lockedSettings.set(q.id, winner);
  }
}

function getDraftMode(v: GameVoteSession): GameVoteDraftMode {
  const opt = v.lockedSettings.get('draft_mode');
  if (opt === 'snake' || opt === 'random' || opt === 'cwc') return opt;
  return 'standard';
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

function makeVoteSeed(args: StartGameVoteOptions): GameVoteSessionSeed {
  const voters: GameVoteVoter[] = args.voters.map((v: VoterUser) => ({
    id: v.id,
    displayName: v.displayName,
  }));

  const questions = buildGameVoteConfig({
    gameType: args.gameType,
    blindMode: args.blindMode,
  }).questions;

  return {
    edition: args.edition,
    gameType: args.gameType,
    startingAge: args.startingAge,
    numberTeams: args.numberTeams,
    blindMode: args.blindMode,
    hostId: args.host.id,
    voters,
    questions,
  };
}

function ensureSessionSeedValid(seed: GameVoteSessionSeed): string | null {
  if (seed.voters.length < 2 && seed.gameType !== 'Duel') {
    return `${EMOJI_FAIL} A vote requires at least **2** voters.`;
  }

  if (seed.gameType === 'Teamer') {
    if (!seed.numberTeams) {
      return `${EMOJI_FAIL} Teamer requires **number-teams**.`;
    }
    if (seed.blindMode) {
      return `${EMOJI_FAIL} Blind mode is not allowed for **Teamer**.`;
    }
  }

  if (seed.edition === 'CIV7' && !seed.startingAge) {
    return `${EMOJI_FAIL} Civ7 requires **starting-age**.`;
  }

  return null;
}

async function getSelfMember(guild: Guild): Promise<GuildMember | null> {
  const cached = guild.members.me;
  if (cached) return cached;
  try {
    return await guild.members.fetchMe();
  } catch {
    return null;
  }
}

type PermissionCheckedChannel = Readonly<{
  id: string;
  permissionsFor: (member: GuildMember) => Readonly<PermissionsBitField> | null;
}>;

function hasPermissionCheck(ch: unknown): ch is PermissionCheckedChannel {
  if (typeof ch !== 'object' || ch === null) return false;
  const obj = ch as { id?: unknown; permissionsFor?: unknown };
  return typeof obj.id === 'string' && typeof obj.permissionsFor === 'function';
}

type ThreadLike = Readonly<{
  isThread: () => boolean;
  archived?: boolean;
  locked?: boolean;
}>;

function isThreadLike(ch: unknown): ch is ThreadLike {
  if (typeof ch !== 'object' || ch === null) return false;
  const obj = ch as { isThread?: unknown };
  return typeof obj.isThread === 'function';
}

function permLabel(flag: bigint): string {
  switch (flag) {
    case PermissionsBitField.Flags.ViewChannel:
      return 'View Channel';
    case PermissionsBitField.Flags.SendMessages:
      return 'Send Messages';
    case PermissionsBitField.Flags.EmbedLinks:
      return 'Embed Links';
    case PermissionsBitField.Flags.SendMessagesInThreads:
      return 'Send Messages in Threads';
    default:
      return 'Unknown Permission';
  }
}

function formatMissingPerms(missing: readonly bigint[]): string {
  const labels = missing
    .map(permLabel)
    .filter((x) => x !== 'Unknown Permission')
    .map((x) => `**${x}**`);
  return labels.join(', ');
}

function getDiscordErrorMeta(
  err: unknown
): Readonly<{ message?: string; code?: number | string; status?: number }> {
  if (!(err instanceof Error)) return {};
  const e = err as Error & { code?: unknown; status?: unknown };
  const code = e.code;
  const status = e.status;
  return {
    message: err.message,
    code: typeof code === 'number' || typeof code === 'string' ? code : undefined,
    status: typeof status === 'number' ? status : undefined,
  };
}


async function openInitialMessages(
  v: GameVoteSession,
  guild: Guild,
  voters: readonly VoterUser[]
): Promise<{ ok: true } | { ok: false; message: string }> {
  // Public status message in vote channel.
  const payload = buildRenderPayload(v);

  // Pre-flight: surface missing channel permissions (most common cause in restricted vote channels).
  const me = await getSelfMember(guild);
  if (me && hasPermissionCheck(v.commandChannel)) {
    const perms = v.commandChannel.permissionsFor(me);
    if (perms) {
      const required: bigint[] = [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.EmbedLinks,
      ];

      const threadLike = isThreadLike(v.commandChannel) && v.commandChannel.isThread();
      if (threadLike) {
        const t = v.commandChannel as unknown as { archived?: boolean; locked?: boolean };
        if (t.archived) {
          return {
            ok: false,
            message: `${EMOJI_FAIL} I can't post in this thread because it is archived.`,
          };
        }
        if (t.locked) {
          return {
            ok: false,
            message: `${EMOJI_FAIL} I can't post in this thread because it is locked.`,
          };
        }
        required.push(PermissionsBitField.Flags.SendMessagesInThreads);
      }

      const missing = required.filter((p) => !perms.has(p));
      if (missing.length) {
        return {
          ok: false,
          message: `${EMOJI_ERROR} I can't post the vote message here. Missing: ${formatMissingPerms(missing)}.`,
        };
      }
    }
  }

  try {
    const msg = await v.commandChannel.send({
      embeds: payload.embeds,
      components: v.blindMode ? [] : payload.components,
      allowedMentions: { parse: [] as const },
    });
    v.publicMessage = msg as Message<true>;
  } catch (err: unknown) {
    const meta = getDiscordErrorMeta(err);

    const channelId =
      typeof (v.commandChannel as unknown as { id?: unknown }).id === 'string'
        ? (v.commandChannel as unknown as { id: string }).id
        : null;

    console.error('GameVote: failed to post public vote message', {
      guildId: v.guildId,
      channelId,
      sessionId: v.sessionId,
      code: meta.code ?? null,
      status: meta.status ?? null,
      message: meta.message ?? null,
    });

    const hint = meta.code || meta.status ? ` (error ${meta.code ?? meta.status})` : '';
    return { ok: false, message: `${EMOJI_ERROR} I couldn't post the vote message here${hint}.` };
  }

  if (!v.blindMode) return { ok: true };

  // DM control message for each voter.
  const voterUsers = voters;
  const dmErrors: string[] = [];

  await forEachLimit(voterUsers, DM_CONCURRENCY, async (vu) => {
    try {
      const dm = await vu.user.send({
        embeds: payload.embeds,
        components: payload.components,
        allowedMentions: { parse: [] as const },
      });
      v.dmMessages.set(vu.id, dm);
    } catch {
      dmErrors.push(vu.id);
    }
  });

  if (dmErrors.length > 0) {
    // Roll back to avoid half-started sessions.
    try {
      await safeEditMessage(v.publicMessage, { components: [] });
    } catch {
      // ignore
    }
    return {
      ok: false,
      message:
        `${EMOJI_FAIL} I couldn't DM all voters. Ask them to enable DMs from this server and try again.\n` +
        `Failed: ${dmErrors.map((id) => `<@${id}>`).join(', ')}`,
    };
  }

  return { ok: true };
}

async function finalizeCleanup(v: GameVoteSession): Promise<void> {
  clearTimeout(v.timeout);
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
    v.phase = 'final';
    return;
  }

  v.phase = 'blind_draft';
  v.blindDraftEndsAtMs = Date.now() + BLIND_DRAFT_DURATION_MS;

  // Update public status message.
  await safeEditMessage(v.publicMessage, buildRenderPayload(v));

  // Push pick UI to each DM.
  await forEachLimit<string>(v.voterIds, DM_CONCURRENCY, async (id) => {
    const dm = v.dmMessages.get(id);
    if (!dm) return;
    const rows = buildBlindPickComponents({ session: v, voterId: id });
    await safeEditMessage(dm, {
      embeds: buildRenderPayload(v).embeds,
      components: rows,
    });
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

async function finalizeVote(v: GameVoteSession, _reason: 'timeout' | 'complete'): Promise<void> {
  if (v.isFinalized) return;
  if (v.phase === 'final') return;

  ensureLockedAll(v);
  v.endsAtMs = Date.now();

  if (v.blindMode) {
    // Prevent the vote timer firing after we've entered blind draft.
    clearTimeout(v.timeout);

    // Voting finished: proceed to blind draft.
    await safeEditMessage(v.publicMessage, buildRenderPayload(v));
    await broadcastDMs(v);
    await startBlindDraft(v);
    return;
  }

  v.phase = 'final';
  v.isFinalized = true;

  // Disable controls.
  await safeEditMessage(v.publicMessage, { components: [] });

  await publishDraftResult(v);
  await finalizeCleanup(v);
}

export async function startGameVote(args: StartGameVoteOptions): Promise<StartGameVoteResult> {
  const seed = makeVoteSeed(args);
  const invalid = ensureSessionSeedValid(seed);
  if (invalid) return { ok: false, message: invalid };

  const key = voiceKey(args.guild.id, args.voiceChannelId);
  if (reservedByVoice.has(key) || activeByVoice.has(key)) {
    return {
      ok: false,
      message: `${EMOJI_FAIL} A game vote is already active for this voice channel.`,
    };
  }

  reservedByVoice.add(key);

  try {
    const sessionId = randomUUID();
    const now = Date.now();

    const v: GameVoteSession = {
      sessionId,
      guildId: args.guild.id,
      voiceChannelId: args.voiceChannelId,
      commandChannel: args.commandChannel,
      hostId: args.host.id,
      edition: seed.edition,
      gameType: seed.gameType,
      startingAge: seed.startingAge,
      numberTeams: seed.numberTeams,
      blindMode: seed.blindMode,
      voters: seed.voters,
      voterIds: seed.voters.map((x: GameVoteVoter) => x.id),
      startedAtMs: now,
      endsAtMs: now + VOTE_DURATION_MS,
      phase: 'voting',
      questions: seed.questions,
      questionIndex: 0,
      votesByQuestion: new Map(),
      lockedSettings: new Map(),
      bansByVoter: new Map(),
      bansSubmitted: new Set(),
      finished: new Set(),
      publicMessage: null as unknown as Message<true>,
      dmMessages: new Map(),
      timeout: null as unknown as NodeJS.Timeout,
      isFinalized: false,
      blindDraftEndsAtMs: null,
      blindDraftTimeout: null,
      blindDraftPools: new Map(),
      blindDraftPicks: new Map(),
      blindDraftPages: new Map(),
    };

    activeById.set(sessionId, v);
    activeByVoice.set(key, v);

    v.timeout = setTimeout(() => {
      void finalizeVote(v, 'timeout');
    }, VOTE_DURATION_MS);

    const open = await openInitialMessages(v, args.guild, args.voters);
    if (!open.ok) {
      await finalizeCleanup(v);
      return { ok: false, message: open.message };
    }

    return { ok: true, sessionId };
  } finally {
    reservedByVoice.delete(key);
  }
}

function parseCustomId(
  customId: string
): Readonly<{ action: string; sessionId: string; sub?: string; dir?: string }> | null {
  // vote flow: gv:<action>:<sessionId>
  // blind picks: gv:pick:<civ|leader>:<sessionId>
  // blind nav:  gv:nav:<civ|leader>:<prev|next>:<sessionId>
  if (!customId.startsWith('gv:')) return null;
  const parts = customId.split(':');
  if (parts.length < 3) return null;

  const action = parts[1];
  if (!action) return null;

  if (action === 'pick') {
    if (parts.length !== 4) return null;
    const sub = parts[2];
    const sessionId = parts[3];
    if (!sub || !sessionId) return null;
    return { action, sub, sessionId };
  }

  if (action === 'nav') {
    if (parts.length !== 5) return null;
    const sub = parts[2];
    const dir = parts[3];
    const sessionId = parts[4];
    if (!sub || !dir || !sessionId) return null;
    return { action, sub, dir, sessionId };
  }

  const sessionId = parts[2];
  if (!sessionId) return null;
  return { action, sessionId };
}

function getSession(customId: string): GameVoteSession | null {
  const parsed = parseCustomId(customId);
  if (!parsed) return null;
  return activeById.get(parsed.sessionId) ?? null;
}

function isVoter(v: GameVoteSession, userId: string): boolean {
  return v.voterIds.includes(userId);
}

export async function handleGameVoteSelect(
  interaction: StringSelectMenuInteraction
): Promise<boolean> {
  const parsed = parseCustomId(interaction.customId);
  if (!parsed) return false;
  if (parsed.action !== 'vote' && parsed.action !== 'pick') return false;

  const v = getSession(interaction.customId);
  if (!v) {
    await replyNotice(interaction, `${EMOJI_FAIL} This vote session is no longer active.`);
    return true;
  }

  if (!isVoter(v, interaction.user.id)) {
    await replyNotice(interaction, `${EMOJI_FAIL} You are not a voter in this session.`);
    return true;
  }

  // Voting phase
  if (parsed.action === 'vote') {
    if (v.phase !== 'voting') {
      await replyNotice(interaction, `${EMOJI_FAIL} Voting is not active right now.`);
      return true;
    }

    const q = currentQuestion(v);
    if (!q) {
      await replyNotice(interaction, `${EMOJI_ERROR} Vote state error (no current question).`);
      return true;
    }

    const choice = interaction.values[0];
    if (!q.options.some((o) => o.id === choice)) {
      await replyNotice(interaction, `${EMOJI_FAIL} Invalid choice.`);
      return true;
    }

    const rec = v.votesByQuestion.get(q.id) ?? new Map();
    rec.set(interaction.user.id, choice);
    v.votesByQuestion.set(q.id, rec);

    const advanced = lockCurrentQuestionIfReady(v);
    const payload = buildRenderPayload(v);

    try {
      await interaction.update({
        embeds: payload.embeds,
        components: v.blindMode ? payload.components : payload.components,
        allowedMentions: { parse: [] as const },
      });
    } catch {
      // ignore
    }

    // If blind mode and question advanced, update all DMs to show the next question.
    if (advanced) {
      await broadcastDMs(v, payload);
    }

    // If we switched into bans, push updates.
    const phaseAfter = v.phase as GameVotePhase;
    if (phaseAfter === 'bans') {
      await safeEditMessage(v.publicMessage, v.blindMode ? { embeds: payload.embeds, components: [] } : payload);
      if (v.blindMode) await broadcastDMs(v, payload);
    }

    return true;
  }

  // Blind draft pick phase
  if (v.phase !== 'blind_draft') {
    await replyNotice(interaction, `${EMOJI_FAIL} Draft picks are not active.`);
    return true;
  }

  const pickType = parsed.sub;
  if (pickType !== 'civ' && pickType !== 'leader') {
    await replyNotice(interaction, `${EMOJI_FAIL} Invalid pick type.`);
    return true;
  }

  const pools = v.blindDraftPools.get(interaction.user.id);
  if (!pools) {
    await replyNotice(interaction, `${EMOJI_FAIL} No draft pool found for you.`);
    return true;
  }

  const value = interaction.values[0];
  const pick = v.blindDraftPicks.get(interaction.user.id) ?? {};

  if (pickType === 'civ') {
    if (v.edition !== 'CIV7' || !pools.civs?.includes(value)) {
      await replyNotice(interaction, `${EMOJI_FAIL} Invalid civ pick.`);
      return true;
    }
    pick.civKey = value;
  } else {
    if (!pools.leaders.includes(value)) {
      await replyNotice(interaction, `${EMOJI_FAIL} Invalid leader pick.`);
      return true;
    }
    pick.leaderKey = value;
  }

  v.blindDraftPicks.set(interaction.user.id, pick);

  // Update the DM message components (keep selects enabled for remaining pick).
  const rows = buildBlindPickComponents({ session: v, voterId: interaction.user.id });
  try {
    await interaction.update({
      embeds: buildRenderPayload(v).embeds,
      components: rows,
      allowedMentions: { parse: [] as const },
    });
  } catch {
    // ignore
  }

  // Early completion
  const allPicked = v.voterIds.every((id: string) => {
    const p = v.blindDraftPicks.get(id);
    if (!p) return false;
    if (v.edition === 'CIV6') return Boolean(p.leaderKey);
    return Boolean(p.civKey && p.leaderKey);
  });
  if (allPicked) {
    await finalizeBlindDraft(v, 'complete');
  } else {
    await safeEditMessage(v.publicMessage, buildRenderPayload(v));
  }
  return true;
}

export async function handleGameVoteButton(
  interaction: ButtonInteraction
): Promise<boolean> {
  const parsed = parseCustomId(interaction.customId);
  if (!parsed) return false;
  if (parsed.action !== 'ban' && parsed.action !== 'finish' && parsed.action !== 'nav') return false;

  const v = getSession(interaction.customId);
  if (!v) {
    await replyNotice(interaction, `${EMOJI_FAIL} This vote session is no longer active.`);
    return true;
  }

  if (!isVoter(v, interaction.user.id)) {
    await replyNotice(interaction, `${EMOJI_FAIL} You are not a voter in this session.`);
    return true;
  }

  if (parsed.action === 'nav') {
    if (!v.blindMode || v.phase !== 'blind_draft') {
      await replyNotice(interaction, `${EMOJI_FAIL} Navigation is only available during blind draft.`);
      return true;
    }

    const list = parsed.sub;
    const dir = parsed.dir;
    if ((list !== 'civ' && list !== 'leader') || (dir !== 'prev' && dir !== 'next')) {
      await replyNotice(interaction, `${EMOJI_FAIL} Invalid navigation action.`);
      return true;
    }

    const pools = v.blindDraftPools.get(interaction.user.id);
    if (!pools) {
      await replyNotice(interaction, `${EMOJI_ERROR} Draft pool not found.`);
      return true;
    }

    const current = v.blindDraftPages.get(interaction.user.id) ?? { civPage: 0, leaderPage: 0 };
    const nextState = { ...current };

    if (list === 'civ') {
      const civs = pools.civs ?? [];
      const maxPage = Math.max(0, Math.ceil(civs.length / BLIND_MENU_PAGE_SIZE) - 1);
      nextState.civPage = Math.max(
        0,
        Math.min(maxPage, current.civPage + (dir === 'next' ? 1 : -1))
      );
    } else {
      const maxPage = Math.max(0, Math.ceil(pools.leaders.length / BLIND_MENU_PAGE_SIZE) - 1);
      nextState.leaderPage = Math.max(
        0,
        Math.min(maxPage, current.leaderPage + (dir === 'next' ? 1 : -1))
      );
    }

    v.blindDraftPages.set(interaction.user.id, nextState);

    const payload = buildRenderPayload(v);
    await interaction.update({
      embeds: payload.embeds,
      components: buildBlindPickComponents({ session: v, voterId: interaction.user.id }),
    });
    return true;
  }

  if (v.phase !== 'bans') {
    await replyNotice(interaction, `${EMOJI_FAIL} This action isn't available right now.`);
    return true;
  }

  if (parsed.action === 'ban') {
    const modal = new ModalBuilder()
      .setCustomId(`gv:banmodal:${v.sessionId}`)
      .setTitle(v.edition === 'CIV6' ? 'Leader bans' : 'Leader + Civ bans');

    const leader = new TextInputBuilder()
      .setCustomId('leader_bans')
      .setLabel('Leader bans (paste emojis, comma-separated)')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false);

    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(leader));

    if (v.edition === 'CIV7') {
      const civ = new TextInputBuilder()
        .setCustomId('civ_bans')
        .setLabel('Civ bans (paste emojis, comma-separated)')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false);
      modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(civ));
    }

    try {
      await interaction.showModal(modal);
    } catch {
      await replyNotice(interaction, `${EMOJI_ERROR} Unable to open ban form.`);
    }
    return true;
  }

  // finish
  v.finished.add(interaction.user.id);

  const payload = buildRenderPayload(v);
  try {
    await interaction.update({
      embeds: payload.embeds,
      components: payload.components,
      allowedMentions: { parse: [] as const },
    });
  } catch {
    // ignore
  }

  await safeEditMessage(v.publicMessage, v.blindMode ? { embeds: payload.embeds, components: [] } : payload);
  if (v.blindMode) await broadcastDMs(v, payload);

  if (v.finished.size >= v.voterIds.length) {
    await finalizeVote(v, 'complete');
  }
  return true;
}

export async function handleGameVoteModal(
  interaction: ModalSubmitInteraction
): Promise<boolean> {
  const parsed = parseCustomId(interaction.customId);
  if (!parsed) return false;
  if (parsed.action !== 'banmodal') return false;

  const v = getSession(interaction.customId);
  if (!v) {
    await replyNotice(interaction, `${EMOJI_FAIL} This vote session is no longer active.`);
    return true;
  }

  if (!isVoter(v, interaction.user.id)) {
    await replyNotice(interaction, `${EMOJI_FAIL} You are not a voter in this session.`);
    return true;
  }

  if (v.phase !== 'bans') {
    await replyNotice(interaction, `${EMOJI_FAIL} Bans are not active right now.`);
    return true;
  }

  const leaderRaw = interaction.fields.getTextInputValue('leader_bans')?.trim() ?? '';
  const civRaw = v.edition === 'CIV7'
    ? (interaction.fields.getTextInputValue('civ_bans')?.trim() ?? '')
    : undefined;

  v.bansByVoter.set(interaction.user.id, { leaderRaw, civRaw });
  v.bansSubmitted.add(interaction.user.id);

  await replyNotice(interaction, '✅ Bans submitted.');

  const payload = buildRenderPayload(v);
  await safeEditMessage(v.publicMessage, v.blindMode ? { embeds: payload.embeds, components: [] } : payload);
  if (v.blindMode) await broadcastDMs(v, payload);
  return true;
}
