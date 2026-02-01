import { EmbedBuilder } from 'discord.js';

import { lookupCiv6LeaderMeta } from '../../data/civ6-data.js';
import {
  lookupCiv7CivMeta,
  lookupCiv7LeaderMeta,
} from '../../data/civ7-data.js';
import type {
  Civ6DraftResult,
  Civ7DraftResult,
  DraftGameType,
} from '../../types/draft.js';

const EMOJI_NAME_SAFE_RE = /[^A-Za-z0-9_]/g;

function sanitizeEmojiName(name: string): string {
  const cleaned = name.replace(EMOJI_NAME_SAFE_RE, '_').replace(/_+/g, '_');
  const trimmed = cleaned.replace(/^_+|_+$/g, '');
  return trimmed.length >= 2 ? trimmed.slice(0, 32) : 'civ';
}

function titleCaseWord(w: string): string {
  if (!w) return w;
  if (/^[IVX]+$/.test(w)) return w; // roman numerals
  if (w.length <= 3 && w === w.toUpperCase()) return w;
  return w[0].toUpperCase() + w.slice(1).toLowerCase();
}

function humanizeKey(key: string): string {
  const stripped = key
    .replace(/^LEADER_/, '')
    .replace(/^CIVILIZATION_/, '')
    .trim();
  return stripped
    .split('_')
    .filter(Boolean)
    .map(titleCaseWord)
    .join(' ');
}

function labelForGroup(kind: 'Player' | 'Team', idx: number): string {
  return kind === 'Team' ? `Team ${idx + 1}` : `Player ${idx + 1}`;
}

function formatHeader(args: Readonly<{
  game: 'civ6' | 'civ7';
  gameType: DraftGameType;
  leadersPerGroup: number;
  civsPerGroup?: number;
  startingAge?: string;
}>): string {
  // Keep the header compact for mobile: short labels, minimal lines.
  const line1 =
    args.game === 'civ6'
      ? `civ6 • ${args.gameType}`
      : `civ7 • ${args.gameType} • ${args.startingAge ?? '—'}`;

  const line2 =
    args.game === 'civ6'
      ? `Leaders: ${args.leadersPerGroup} each`
      : `Leaders: ${args.leadersPerGroup} each • Civs: ${args.civsPerGroup ?? 0} each`;

  return `${line1}\n${line2}`;
}

function renderBanList(args: Readonly<{
  keys?: readonly string[];
  lookup: (key: string) => Readonly<{ gameId: string; emojiId?: string }> | undefined;
  max?: number;
}>): { text: string; more: number } | undefined {
  const { keys, max = 8 } = args;
  if (!keys || keys.length === 0) return undefined;
  const shown = keys.slice(0, max).map((k) => renderLine(args.lookup(k), k));
  return { text: shown.join(', '), more: Math.max(0, keys.length - shown.length) };
}

function formatBansLine(args: Readonly<{
  leaderKeys?: readonly string[];
  civKeys?: readonly string[];
  leaderLookup: (key: string) => Readonly<{ gameId: string; emojiId?: string }> | undefined;
  civLookup?: (key: string) => Readonly<{ gameId: string; emojiId?: string }> | undefined;
}>): string | undefined {
  const leaders = renderBanList({ keys: args.leaderKeys, lookup: args.leaderLookup });
  const civs = args.civLookup
    ? renderBanList({ keys: args.civKeys, lookup: args.civLookup })
    : undefined;

  if (!leaders && !civs) return undefined;

  // Civ6: bans are leaders-only, keep the line short.
  if (leaders && !args.civLookup) {
    return `Bans: ${leaders.text}${leaders.more ? ` (+${leaders.more})` : ''}`;
  }

  const parts: string[] = [];
  if (leaders) parts.push(`Leaders ${leaders.text}${leaders.more ? ` (+${leaders.more})` : ''}`);
  if (civs) parts.push(`Civs ${civs.text}${civs.more ? ` (+${civs.more})` : ''}`);
  return `Bans: ${parts.join(' • ')}`;
}

function formatIgnoredLine(args: Readonly<{ leader?: readonly string[]; civ?: readonly string[] }>): string | undefined {
  const leader = args.leader?.filter(Boolean) ?? [];
  const civ = args.civ?.filter(Boolean) ?? [];
  if (leader.length === 0 && civ.length === 0) return undefined;

  if (leader.length && civ.length === 0) {
    return `Ignored: ${leader.slice(0, 8).join(', ')}${leader.length > 8 ? ` (+${leader.length - 8})` : ''}`;
  }

  const parts: string[] = [];
  if (leader.length) parts.push(`Leaders ${leader.slice(0, 8).join(', ')}${leader.length > 8 ? ` (+${leader.length - 8})` : ''}`);
  if (civ.length) parts.push(`Civs ${civ.slice(0, 8).join(', ')}${civ.length > 8 ? ` (+${civ.length - 8})` : ''}`);
  return `Ignored: ${parts.join(' • ')}`;
}

function renderLine(meta: Readonly<{ gameId: string; emojiId?: string }> | undefined, fallbackKey: string): string {
  if (!meta) return humanizeKey(fallbackKey);
  const name = meta.gameId;
  const emojiId = meta.emojiId?.trim();
  if (!emojiId) return name;
  return `<:${sanitizeEmojiName(meta.gameId)}:${emojiId}> ${name}`;
}

export function buildCiv6DraftEmbed(
  draft: Civ6DraftResult
): EmbedBuilder {
  const header = formatHeader({
    game: 'civ6',
    gameType: draft.gameType,
    leadersPerGroup: draft.allocation.leadersPerGroup,
  });

  const lines: string[] = [header];

  const bansLine = formatBansLine({
    leaderKeys: draft.allocation.bannedLeaders,
    leaderLookup: lookupCiv6LeaderMeta,
  });
  const ignoredLine = formatIgnoredLine({ leader: draft.allocation.ignoredLeaderBans });
  if (bansLine) lines.push(bansLine);
  if (ignoredLine) lines.push(ignoredLine);
  for (let i = 0; i < draft.groups.length; i++) {
    lines.push('');
    lines.push(`**${labelForGroup(draft.allocation.groupKind, i)}**`);
    for (const k of draft.groups[i].leaders) {
      lines.push(renderLine(lookupCiv6LeaderMeta(k), k));
    }
  }

  return new EmbedBuilder()
    .setTitle('Draft')
    .setDescription(lines.join('\n'))
    .setColor(0x00ff00);
}

export function buildCiv7DraftEmbed(
  draft: Civ7DraftResult
): EmbedBuilder {
  const header = formatHeader({
    game: 'civ7',
    gameType: draft.gameType,
    startingAge: draft.startingAge,
    leadersPerGroup: draft.allocation.leadersPerGroup,
    civsPerGroup: draft.allocation.civsPerGroup,
  });

  const lines: string[] = [header];

  const bansLine = formatBansLine({
    leaderKeys: draft.allocation.bannedLeaders,
    civKeys: draft.allocation.bannedCivs,
    leaderLookup: lookupCiv7LeaderMeta,
    civLookup: lookupCiv7CivMeta,
  });
  const ignoredLine = formatIgnoredLine({
    leader: draft.allocation.ignoredLeaderBans,
    civ: draft.allocation.ignoredCivBans,
  });
  if (bansLine) lines.push(bansLine);
  if (ignoredLine) lines.push(ignoredLine);

  for (let i = 0; i < draft.groups.length; i++) {
    const g = draft.groups[i];
    lines.push('');
    lines.push(`**${labelForGroup(draft.allocation.groupKind, i)}**`);
    lines.push('**Leaders**');
    for (const k of g.leaders) {
      lines.push(renderLine(lookupCiv7LeaderMeta(k), k));
    }
    lines.push('');
    lines.push('**Civs**');
    for (const k of g.civs ?? []) {
      lines.push(renderLine(lookupCiv7CivMeta(k), k));
    }
  }

  return new EmbedBuilder()
    .setTitle('Draft')
    .setDescription(lines.join('\n'))
    .setColor(0x00ff00);
}
