import { EmbedBuilder, type MessageCreateOptions, type MessageEditOptions } from 'discord.js';

import { getGameVoteBanLimits } from '../../../config/draft.config.js';
import type { CivEdition } from '../../../config/types.js';
import { CIV6_LEADERS } from '../../../data/civ6.data.js';
import { CIV7_CIVS, CIV7_LEADERS, formatCiv7Civ, formatCiv7Leader } from '../../../data/civ7.data.js';
import type { GameVoteSession } from '../../../types/voting.types.js';
import { buildBansPanelComponents, type BanMenuOption } from '../../../ui/components/bans-panel.js';
import {
  ensureStagedBans,
  getBanPageState,
  getBanSearchState,
  hasStagedBanChanges,
  setBanPageState,
} from '../runtime/bans-state.service.js';
import { formatCiv6Leader } from '../../../data/civ6.data.js';

export const BAN_LEADER_PAGE_SIZE = 25;
export const BAN_CIV_PAGE_SIZE = 24;

export type BansPanelPayload = Omit<MessageCreateOptions, 'flags'> & Omit<MessageEditOptions, 'flags'>;

type BanMeta = Readonly<{ gameId: string; emojiId?: string }>;

function getBanLimits(v: GameVoteSession): Readonly<{ leader: number; civ: number }> {
  return getGameVoteBanLimits(v.edition, v.startingAge);
}

function getCiv6LeaderMeta(): Record<string, BanMeta> {
  return CIV6_LEADERS as unknown as Record<string, BanMeta>;
}

function getCiv7LeaderMeta(): Record<string, BanMeta> {
  return CIV7_LEADERS as unknown as Record<string, BanMeta>;
}

function getCiv7CivMeta(): Record<string, BanMeta> {
  return CIV7_CIVS as unknown as Record<string, BanMeta>;
}

export function sortKeysByGameId(source: Record<string, BanMeta>): string[] {
  return Object.entries(source)
    .sort((a, b) => a[1].gameId.localeCompare(b[1].gameId))
    .map(([key]) => key);
}

export function getLeaderBanSource(v: GameVoteSession): Record<string, BanMeta> {
  if (v.edition === 'CIV6') return getCiv6LeaderMeta();
  return getCiv7LeaderMeta();
}

export function getCivBanSource(v: GameVoteSession): Record<string, BanMeta> | null {
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

function formatLeaderBan(v: GameVoteSession, key: string): string {
  return v.edition === 'CIV6' ? formatCiv6Leader(key) : formatCiv7Leader(key);
}

function formatCivBan(key: string): string {
  return formatCiv7Civ(key);
}


function buildEmptyOption(label: string): BanMenuOption {
  return { label, value: '__none__' };
}

function buildBansPanelPayload(args: Readonly<{
  edition: CivEdition;
  sessionId: string;
  finished: boolean;
  submitted: boolean;
  hostLeaderSummary?: string;
  hostCivSummary?: string;
  leaderSummary: string;
  civSummary?: string;
  leaderOptions: readonly BanMenuOption[];
  leaderPage: number;
  leaderPages: number;
  leaderMenuDisabled: boolean;
  leaderMenuMaxValues: number;
  leaderSearchQuery?: string;
  civOptions?: readonly BanMenuOption[];
  civPage: number;
  civPages: number;
  civMenuDisabled: boolean;
  civMenuMaxValues: number;
  civSearchQuery?: string;
  submitDisabled: boolean;
}>): BansPanelPayload {
  const desc: string[] = [
    'Search to filter the main ban menus, or browse with the page controls. Submit an empty search to return to the full list. Host bans are already excluded from the pool.',
    args.hostLeaderSummary ? `**Host Leader:** ${args.hostLeaderSummary}` : undefined,
    args.edition === 'CIV7' && args.hostCivSummary ? `**Host Civ:** ${args.hostCivSummary}` : undefined,
    `**Leader:** ${args.leaderSummary}`,
    args.edition === 'CIV7' ? `**Civ:** ${args.civSummary ?? '—'}` : undefined,
    args.leaderSearchQuery ? `🔎 **Leader search:** ${args.leaderSearchQuery}` : undefined,
    args.edition === 'CIV7' && args.civSearchQuery ? `🔎 **Civ search:** ${args.civSearchQuery}` : undefined,
    args.submitted ? '✅ **Bans saved** — you can keep editing until **Finish Vote**.' : undefined,
  ].filter((line): line is string => Boolean(line));

  const embed = new EmbedBuilder().setTitle('🛑 Bans').setDescription(desc.join('\n'));

  return {
    embeds: [embed],
    components: [...buildBansPanelComponents({
      sessionId: args.sessionId,
      finished: args.finished,
      leaderOptions: args.leaderOptions,
      leaderPage: args.leaderPage,
      leaderPages: args.leaderPages,
      leaderMenuDisabled: args.leaderMenuDisabled,
      leaderMenuMaxValues: args.leaderMenuMaxValues,
      leaderSearchQuery: args.leaderSearchQuery,
      civOptions: args.civOptions,
      civPage: args.civPage,
      civPages: args.civPages,
      civMenuDisabled: args.civMenuDisabled,
      civMenuMaxValues: args.civMenuMaxValues,
      civSearchQuery: args.civSearchQuery,
      submitDisabled: args.submitDisabled,
    })],
    allowedMentions: { parse: [] as const },
  };
}

function normalizeSearchQuery(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/<a?:([^:>]+):\d+>/g, '$1')
    .replace(/:([^:\s]+):/g, '$1')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function buildSearchTokens(key: string, meta: BanMeta): string[] {
  const raw = [key, meta.gameId, key.replace(/[_-]+/g, ' ')];
  return raw
    .map((value) => normalizeSearchQuery(value))
    .filter((value, index, arr) => value.length > 0 && arr.indexOf(value) === index);
}

function rankSearchMatch(key: string, meta: BanMeta, rawQuery: string): number | null {
  const query = normalizeSearchQuery(rawQuery);
  if (!query) return null;
  const tokens = buildSearchTokens(key, meta);
  if (tokens.some((token) => token == query)) return 0;
  if (tokens.some((token) => token.startsWith(query))) return 1;
  if (tokens.some((token) => token.includes(query))) return 2;
  return null;
}

function filterSearchKeys(keys: readonly string[], source: Record<string, BanMeta>, rawQuery?: string): string[] | null {
  if (!rawQuery || rawQuery.trim().length === 0) return null;
  return [...keys]
    .map((key) => ({ key, rank: rankSearchMatch(key, source[key], rawQuery) }))
    .filter((entry): entry is { key: string; rank: number } => entry.rank !== null)
    .sort((a, b) => (a.rank - b.rank) || source[a.key].gameId.localeCompare(source[b.key].gameId))
    .map((entry) => entry.key);
}

export function getVisibleLeaderBanKeys(v: GameVoteSession, voterId: string): readonly string[] {
  const leaders = getLeaderBanSource(v);
  const hostLeaderBanSet = new Set(v.hostLeaderBanKeys);
  const allKeys = sortKeysByGameId(leaders).filter((key) => !hostLeaderBanSet.has(key));
  const search = getBanSearchState(v, voterId);
  const filtered = filterSearchKeys(allKeys, leaders, search.leaderQuery);
  if (filtered) return filtered.slice(0, BAN_LEADER_PAGE_SIZE);

  const page = getBanPageState(v, voterId);
  const pages = Math.max(1, Math.ceil(allKeys.length / BAN_LEADER_PAGE_SIZE));
  const leaderPage = Math.min(Math.max(page.leaderPage, 0), pages - 1);
  return allKeys.slice(leaderPage * BAN_LEADER_PAGE_SIZE, leaderPage * BAN_LEADER_PAGE_SIZE + BAN_LEADER_PAGE_SIZE);
}

export function getVisibleCivBanKeys(v: GameVoteSession, voterId: string): readonly string[] {
  const civs = getCivBanSource(v);
  if (!civs) return [];
  const hostCivBanSet = new Set(v.hostCivBanKeys);
  const allKeys = sortKeysByGameId(civs).filter((key) => !hostCivBanSet.has(key));
  const search = getBanSearchState(v, voterId);
  const filtered = filterSearchKeys(allKeys, civs, search.civQuery);
  if (filtered) return filtered.slice(0, BAN_CIV_PAGE_SIZE);

  const page = getBanPageState(v, voterId);
  const pages = Math.max(1, Math.ceil(allKeys.length / BAN_CIV_PAGE_SIZE));
  const civPage = Math.min(Math.max(page.civPage, 0), pages - 1);
  return allKeys.slice(civPage * BAN_CIV_PAGE_SIZE, civPage * BAN_CIV_PAGE_SIZE + BAN_CIV_PAGE_SIZE);
}

export function buildBansPanelViewPayload(v: GameVoteSession, voterId: string): BansPanelPayload {
  const finished = v.finished.has(voterId);
  const leaders = getLeaderBanSource(v);
  const civs = getCivBanSource(v);

  const hostLeaderBanSet = new Set(v.hostLeaderBanKeys);
  const hostCivBanSet = new Set(v.hostCivBanKeys);

  const leaderKeys = sortKeysByGameId(leaders).filter((key) => !hostLeaderBanSet.has(key));
  const civKeys = civs ? sortKeysByGameId(civs).filter((key) => !hostCivBanSet.has(key)) : [];

  const page = getBanPageState(v, voterId);
  const search = getBanSearchState(v, voterId);
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

  const leaderSlice = getVisibleLeaderBanKeys(v, voterId);

  const rawLeaderOptions = leaderSlice.map((key) => {
    const meta = leaders[key];
    return {
      label: meta?.gameId ?? key,
      value: key,
      emoji: toSelectEmoji(meta?.emojiId),
      default: selectedLeaders.has(key),
    };
  });
  const leaderOptions = rawLeaderOptions.length > 0 ? rawLeaderOptions : [buildEmptyOption(search.leaderQuery ? 'No matching leaders found' : 'No leaders available')];
  const selectedLeaderOnPage = leaderSlice.filter((key) => selectedLeaders.has(key)).length;
  const selectedLeaderOffPage = bans.leaderKeys.length - selectedLeaderOnPage;
  const leaderMaxOnPage = Math.min(leaderOptions.length, Math.max(0, limits.leader - selectedLeaderOffPage));

  let civOptions: BanMenuOption[] | undefined;
  let selectedCivOnPage = 0;
  let civMaxOnPage = 0;
  if (civs) {
    const civSlice = getVisibleCivBanKeys(v, voterId);
    const rawCivOptions: BanMenuOption[] = civSlice.map((key) => {
      const meta = civs[key];
      return {
        label: meta?.gameId ?? key,
        value: key,
        emoji: toSelectEmoji(meta?.emojiId),
        default: selectedCivs.has(key),
      };
    });
    civOptions = rawCivOptions.length > 0 ? rawCivOptions : [buildEmptyOption(search.civQuery ? 'No matching civs found' : 'No civs available')];
    selectedCivOnPage = civSlice.filter((key) => selectedCivs.has(key)).length;
    const selectedCivOffPage = bans.civKeys.length - selectedCivOnPage;
    civMaxOnPage = Math.min(civOptions.length, Math.max(0, limits.civ - selectedCivOffPage));
  }

  const hostLeaderSummary = v.hostLeaderBanKeys.length > 0
    ? clampBanList(v.hostLeaderBanKeys.map((key) => formatLeaderBan(v, key)), 900)
    : undefined;
  const hostCivSummary = v.edition === 'CIV7' && v.hostCivBanKeys.length > 0
    ? clampBanList(v.hostCivBanKeys.map((key) => formatCivBan(key)), 900)
    : undefined;
  const leaderSummary = clampBanList(bans.leaderKeys.map((key) => formatLeaderBan(v, key)), 900);
  const civSummary = v.edition === 'CIV7' ? clampBanList(bans.civKeys.map((key) => formatCivBan(key)), 900) : undefined;
  const submitted = v.bansSubmitted.has(voterId) && !hasStagedBanChanges(v, voterId);

  return buildBansPanelPayload({
    edition: v.edition,
    sessionId: v.sessionId,
    finished,
    submitted,
    hostLeaderSummary,
    hostCivSummary,
    leaderSummary,
    civSummary,
    leaderOptions,
    leaderPage,
    leaderPages,
    leaderSearchQuery: search.leaderQuery,
    leaderMenuDisabled: finished || leaderSlice.length === 0 || (leaderMaxOnPage === 0 && selectedLeaderOnPage === 0),
    leaderMenuMaxValues: Math.max(1, leaderMaxOnPage || selectedLeaderOnPage || 1),
    civOptions,
    civPage,
    civPages,
    civSearchQuery: search.civQuery,
    civMenuDisabled: finished || !civs || getVisibleCivBanKeys(v, voterId).length === 0 || (civMaxOnPage === 0 && selectedCivOnPage === 0),
    civMenuMaxValues: Math.max(1, civMaxOnPage || selectedCivOnPage || 1),
    submitDisabled: finished || !hasStagedBanChanges(v, voterId),
  });
}
