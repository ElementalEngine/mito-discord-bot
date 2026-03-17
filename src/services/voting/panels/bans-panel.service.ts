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
  civOptions?: readonly BanMenuOption[];
  civPage: number;
  civPages: number;
  civMenuDisabled: boolean;
  civMenuMaxValues: number;
  submitDisabled: boolean;
}>): BansPanelPayload {
  const desc: string[] = [
    'Type bans with the buttons below, or browse with the select menus. Names, IDs, aliases, and matching emoji names are all accepted. Host bans are already excluded from the pool.',
    args.hostLeaderSummary ? `**Host Leader:** ${args.hostLeaderSummary}` : undefined,
    args.edition === 'CIV7' && args.hostCivSummary ? `**Host Civ:** ${args.hostCivSummary}` : undefined,
    `**Leader:** ${args.leaderSummary}`,
    args.edition === 'CIV7' ? `**Civ:** ${args.civSummary ?? '—'}` : undefined,
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
      civOptions: args.civOptions,
      civPage: args.civPage,
      civPages: args.civPages,
      civMenuDisabled: args.civMenuDisabled,
      civMenuMaxValues: args.civMenuMaxValues,
      submitDisabled: args.submitDisabled,
    })],
    allowedMentions: { parse: [] as const },
  };
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
    leaderPage * BAN_LEADER_PAGE_SIZE + BAN_LEADER_PAGE_SIZE,
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

  let civOptions: { label: string; value: string; emoji?: { id: string }; default: boolean }[] | undefined;
  let selectedCivOnPage = 0;
  let civMaxOnPage = 0;
  if (civs) {
    const civSlice = civKeys.slice(civPage * BAN_CIV_PAGE_SIZE, civPage * BAN_CIV_PAGE_SIZE + BAN_CIV_PAGE_SIZE);
    civOptions = civSlice.map((key) => {
      const meta = civs[key];
      return {
        label: meta?.gameId ?? key,
        value: key,
        emoji: toSelectEmoji(meta?.emojiId),
        default: selectedCivs.has(key),
      };
    });
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
    leaderMenuDisabled: finished || leaderOptions.length === 0 || (leaderMaxOnPage === 0 && selectedLeaderOnPage === 0),
    leaderMenuMaxValues: Math.max(1, leaderMaxOnPage || selectedLeaderOnPage || 1),
    civOptions,
    civPage,
    civPages,
    civMenuDisabled: finished || !civOptions || civOptions.length === 0 || (civMaxOnPage === 0 && selectedCivOnPage === 0),
    civMenuMaxValues: Math.max(1, civMaxOnPage || selectedCivOnPage || 1),
    submitDisabled: finished || !hasStagedBanChanges(v, voterId),
  });
}
