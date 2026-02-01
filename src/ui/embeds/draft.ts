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
  allocationNote?: string;
  leadersPerGroup: number;
  civsPerGroup?: number;
  startingAge?: string;
}>): string {
  const parts: string[] = [];
  if (args.game === 'civ6') {
    parts.push(`Game: **civ6** • Type: **${args.gameType}**`);
    parts.push(`Leaders: **${args.leadersPerGroup}** each`);
  } else {
    parts.push(
      `Game: **civ7** • Type: **${args.gameType}** • Age: **${args.startingAge ?? '—'}**`
    );
    parts.push(`Leaders: **${args.leadersPerGroup}** each • Civs: **${args.civsPerGroup ?? 0}** each`);
  }
  if (args.allocationNote) parts.push(`Note: ${args.allocationNote}`);
  return parts.join('\n');
}

function renderLine(meta: Readonly<{ gameId: string; emojiId?: string }> | undefined, fallbackKey: string): string {
  if (!meta) return humanizeKey(fallbackKey);
  const name = meta.gameId;
  const emojiId = meta.emojiId?.trim();
  if (!emojiId) return name;
  return `<:${sanitizeEmojiName(meta.gameId)}:${emojiId}> ${name}`;
}

function renderBans(args: Readonly<{
  label: string;
  keys?: readonly string[];
  lookup: (key: string) => Readonly<{ gameId: string; emojiId?: string }> | undefined;
  max?: number;
}>): string | undefined {
  const { keys, max = 12 } = args;
  if (!keys || keys.length === 0) return undefined;
  const shown = keys.slice(0, max).map((k) => renderLine(args.lookup(k), k));
  const suffix = keys.length > max ? ` (+${keys.length - max} more)` : '';
  return `${args.label}: ${shown.join(', ')}${suffix}`;
}

function renderIgnored(args: Readonly<{ label: string; items?: readonly string[]; max?: number }>): string | undefined {
  const { items, max = 12 } = args;
  if (!items || items.length === 0) return undefined;
  const shown = items.slice(0, max).join(', ');
  const suffix = items.length > max ? ` (+${items.length - max} more)` : '';
  return `${args.label}: ${shown}${suffix}`;
}

export function buildCiv6DraftEmbed(
  draft: Civ6DraftResult
): EmbedBuilder {
  const header = formatHeader({
    game: 'civ6',
    gameType: draft.gameType,
    leadersPerGroup: draft.allocation.leadersPerGroup,
    allocationNote: draft.allocation.note,
  });

  const lines: string[] = [header];

  const bannedLeaders = renderBans({
    label: 'Banned leaders',
    keys: draft.allocation.bannedLeaders,
    lookup: lookupCiv6LeaderMeta,
  });
  const ignoredLeaders = renderIgnored({
    label: 'Ignored leader bans',
    items: draft.allocation.ignoredLeaderBans,
  });
  if (bannedLeaders) lines.push(bannedLeaders);
  if (ignoredLeaders) lines.push(ignoredLeaders);
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
    allocationNote: draft.allocation.note,
  });

  const lines: string[] = [header];

  const bannedLeaders = renderBans({
    label: 'Banned leaders',
    keys: draft.allocation.bannedLeaders,
    lookup: lookupCiv7LeaderMeta,
  });
  const bannedCivs = renderBans({
    label: 'Banned civs',
    keys: draft.allocation.bannedCivs,
    lookup: lookupCiv7CivMeta,
  });
  const ignoredLeaders = renderIgnored({
    label: 'Ignored leader bans',
    items: draft.allocation.ignoredLeaderBans,
  });
  const ignoredCivs = renderIgnored({
    label: 'Ignored civ bans',
    items: draft.allocation.ignoredCivBans,
  });
  if (bannedLeaders) lines.push(bannedLeaders);
  if (bannedCivs) lines.push(bannedCivs);
  if (ignoredLeaders) lines.push(ignoredLeaders);
  if (ignoredCivs) lines.push(ignoredCivs);

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
