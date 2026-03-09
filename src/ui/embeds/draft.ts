import { EmbedBuilder } from 'discord.js';

import { lookupCiv6LeaderMeta } from '../../data/civ6.data.js';
import { lookupCiv7CivMeta, lookupCiv7LeaderMeta } from '../../data/civ7.data.js';
import type { Civ6DraftResult, Civ7DraftResult, DraftAllocation } from '../../types/draft.js';
import { humanizeGameId } from '../../utils/humanize-game-id.js';

const EMOJI_NAME_SAFE_RE = /[^A-Za-z0-9_]/g;

function sanitizeEmojiName(name: string): string {
  const cleaned = name.replace(EMOJI_NAME_SAFE_RE, '_').replace(/_+/g, '_');
  const trimmed = cleaned.replace(/^_+|_+$/g, '');
  return trimmed.length >= 2 ? trimmed.slice(0, 32) : 'civ';
}

function renderLine(
  meta: Readonly<{ gameId: string; emojiId?: string }> | undefined,
  fallbackKey: string,
): string {
  const readable = humanizeGameId(meta?.gameId ?? fallbackKey);
  const emojiId = meta?.emojiId?.trim();
  if (!emojiId || !meta) return readable;
  return `<:${sanitizeEmojiName(meta.gameId)}:${emojiId}> ${readable}`;
}

function renderBanList(args: Readonly<{
  keys?: readonly string[];
  lookup: (key: string) => Readonly<{ gameId: string; emojiId?: string }> | undefined;
  emptyLabel: string;
  max?: number;
}>): string {
  const keys = args.keys ?? [];
  if (keys.length === 0) return args.emptyLabel;

  const shown = keys.slice(0, args.max ?? 8).map((key) => renderLine(args.lookup(key), key));
  const more = keys.length - shown.length;
  return `${shown.join(', ')}${more > 0 ? ` (+${more})` : ''}`;
}

function formatIgnoredLine(args: Readonly<{ leader?: readonly string[]; civ?: readonly string[] }>): string | undefined {
  const leader = args.leader?.filter(Boolean) ?? [];
  const civ = args.civ?.filter(Boolean) ?? [];
  if (leader.length === 0 && civ.length === 0) return undefined;

  const parts: string[] = [];
  if (leader.length > 0) {
    parts.push(`Leaders ${leader.slice(0, 8).join(', ')}${leader.length > 8 ? ` (+${leader.length - 8})` : ''}`);
  }
  if (civ.length > 0) {
    parts.push(`Civs ${civ.slice(0, 8).join(', ')}${civ.length > 8 ? ` (+${civ.length - 8})` : ''}`);
  }
  return `Ignored bans: ${parts.join(' • ')}`;
}

function addGroupSummaryLine(lines: string[], kind: 'Player' | 'Team', count: number): void {
  lines.push(`${kind === 'Team' ? 'Teams' : 'Players'}: ${count}`);
}

function pushEvenSplitAdjustment(lines: string[], allocation: DraftAllocation): void {
  const parts: string[] = [];
  if ((allocation.trimmedLeaders ?? 0) > 0) {
    const count = allocation.trimmedLeaders ?? 0;
    parts.push(`${count} leader${count === 1 ? '' : 's'}`);
  }
  if ((allocation.trimmedCivs ?? 0) > 0) {
    const count = allocation.trimmedCivs ?? 0;
    parts.push(`${count} civ${count === 1 ? '' : 's'}`);
  }
  if (parts.length > 0) {
    lines.push(`Even split adjustment: ${parts.join(' and ')} removed from the usable pool.`);
  }
}

function buildSummaryEmbed(title: string, lines: readonly string[]): EmbedBuilder {
  return new EmbedBuilder().setTitle(title).setDescription(lines.join('\n')).setColor(0x00ff00);
}

export function buildCiv6DirectDraftSummaryEmbed(draft: Civ6DraftResult): EmbedBuilder {
  const lines: string[] = [`Game Type: ${draft.gameType}`];
  addGroupSummaryLine(lines, draft.allocation.groupKind, draft.allocation.groupCount);
  lines.push(`Leaders: ${draft.allocation.leadersPerGroup} each`);
  lines.push(
    `Leaders banned: ${renderBanList({
      keys: draft.allocation.bannedLeaders,
      lookup: lookupCiv6LeaderMeta,
      emptyLabel: 'none',
    })}`,
  );

  const ignoredLine = formatIgnoredLine({ leader: draft.allocation.ignoredLeaderBans });
  if (ignoredLine) lines.push(ignoredLine);
  pushEvenSplitAdjustment(lines, draft.allocation);

  return buildSummaryEmbed('Direct Draft Civ 6', lines);
}

export function buildCiv7DirectDraftSummaryEmbed(draft: Civ7DraftResult): EmbedBuilder {
  const lines: string[] = [`Game Type: ${draft.gameType}`, `Starting Age: ${draft.startingAge}`];
  addGroupSummaryLine(lines, draft.allocation.groupKind, draft.allocation.groupCount);
  lines.push(`Leaders: ${draft.allocation.leadersPerGroup} each`);
  lines.push(`Civs: ${draft.allocation.civsPerGroup ?? 0} each`);
  lines.push(
    `Leaders banned: ${renderBanList({
      keys: draft.allocation.bannedLeaders,
      lookup: lookupCiv7LeaderMeta,
      emptyLabel: 'none',
    })}`,
  );
  lines.push(
    `Civs banned: ${renderBanList({
      keys: draft.allocation.bannedCivs,
      lookup: lookupCiv7CivMeta,
      emptyLabel: 'none',
    })}`,
  );

  const ignoredLine = formatIgnoredLine({
    leader: draft.allocation.ignoredLeaderBans,
    civ: draft.allocation.ignoredCivBans,
  });
  if (ignoredLine) lines.push(ignoredLine);
  pushEvenSplitAdjustment(lines, draft.allocation);

  return buildSummaryEmbed('Direct Draft Civ 7', lines);
}

export function buildCiv6VoteDraftSummaryEmbed(draft: Civ6DraftResult): EmbedBuilder {
  const lines: string[] = [`Game Type: ${draft.gameType}`];
  addGroupSummaryLine(lines, draft.allocation.groupKind, draft.allocation.groupCount);
  lines.push(`Leaders: ${draft.allocation.leadersPerGroup} each`);
  lines.push(
    `Leaders banned: ${renderBanList({
      keys: draft.allocation.bannedLeaders,
      lookup: lookupCiv6LeaderMeta,
      emptyLabel: 'none',
    })}`,
  );
  pushEvenSplitAdjustment(lines, draft.allocation);
  return buildSummaryEmbed('Standard Draft Civ 6', lines);
}

export function buildCiv7VoteDraftSummaryEmbed(draft: Civ7DraftResult): EmbedBuilder {
  const lines: string[] = [`Game Type: ${draft.gameType}`, `Starting Age: ${draft.startingAge}`];
  addGroupSummaryLine(lines, draft.allocation.groupKind, draft.allocation.groupCount);
  lines.push(`Leaders: ${draft.allocation.leadersPerGroup} each`);
  lines.push(`Civs: ${draft.allocation.civsPerGroup ?? 0} each`);
  lines.push(
    `Leaders banned: ${renderBanList({
      keys: draft.allocation.bannedLeaders,
      lookup: lookupCiv7LeaderMeta,
      emptyLabel: 'none',
    })}`,
  );
  lines.push(
    `Civs banned: ${renderBanList({
      keys: draft.allocation.bannedCivs,
      lookup: lookupCiv7CivMeta,
      emptyLabel: 'none',
    })}`,
  );
  pushEvenSplitAdjustment(lines, draft.allocation);
  return buildSummaryEmbed('Standard Draft Civ 7', lines);
}
