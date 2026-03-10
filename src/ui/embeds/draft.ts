import { EmbedBuilder } from 'discord.js';

import { lookupCiv6LeaderMeta } from '../../data/civ6.data.js';
import {
  lookupCiv7CivMeta,
  lookupCiv7LeaderMeta,
} from '../../data/civ7.data.js';
import type {
  Civ6DraftResult,
  Civ7DraftResult,
  DraftAllocation,
  DraftGameType,
  DraftGroup,
} from '../../types/draft.types.js';

const EMOJI_NAME_SAFE_RE = /[^A-Za-z0-9_]/g;
const EMBED_FIELD_VALUE_LIMIT = 1024;

function sanitizeEmojiName(name: string): string {
  const cleaned = name.replace(EMOJI_NAME_SAFE_RE, '_').replace(/_+/g, '_');
  const trimmed = cleaned.replace(/^_+|_+$/g, '');
  return trimmed.length >= 2 ? trimmed.slice(0, 32) : 'civ';
}

function titleCaseWord(w: string): string {
  if (!w) return w;
  if (/^[IVX]+$/.test(w)) return w;
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
  lookup: (
    key: string,
  ) => Readonly<{ gameId: string; emojiId?: string }> | undefined;
  max?: number;
}>): { text: string; more: number } | undefined {
  const { keys, max = 8 } = args;
  if (!keys || keys.length === 0) return undefined;

  const shown = keys
    .slice(0, max)
    .map((key) => renderLine(args.lookup(key), key));

  return {
    text: shown.join(', '),
    more: Math.max(0, keys.length - shown.length),
  };
}

function formatBansLine(args: Readonly<{
  leaderKeys?: readonly string[];
  civKeys?: readonly string[];
  leaderLookup: (
    key: string,
  ) => Readonly<{ gameId: string; emojiId?: string }> | undefined;
  civLookup?: (
    key: string,
  ) => Readonly<{ gameId: string; emojiId?: string }> | undefined;
}>): string | undefined {
  const leaders = renderBanList({
    keys: args.leaderKeys,
    lookup: args.leaderLookup,
  });
  const civs = args.civLookup
    ? renderBanList({ keys: args.civKeys, lookup: args.civLookup })
    : undefined;

  if (!leaders && !civs) return undefined;

  if (leaders && !args.civLookup) {
    return `Bans: ${leaders.text}${leaders.more ? ` (+${leaders.more})` : ''}`;
  }

  const parts: string[] = [];
  if (leaders) {
    parts.push(`Leaders ${leaders.text}${leaders.more ? ` (+${leaders.more})` : ''}`);
  }
  if (civs) {
    parts.push(`Civs ${civs.text}${civs.more ? ` (+${civs.more})` : ''}`);
  }

  return `Bans: ${parts.join(' • ')}`;
}

function formatIgnoredLine(args: Readonly<{
  leader?: readonly string[];
  civ?: readonly string[];
}>): string | undefined {
  const leader = args.leader?.filter(Boolean) ?? [];
  const civ = args.civ?.filter(Boolean) ?? [];

  if (leader.length === 0 && civ.length === 0) return undefined;

  if (leader.length > 0 && civ.length === 0) {
    return `Ignored: ${leader.slice(0, 8).join(', ')}${leader.length > 8 ? ` (+${leader.length - 8})` : ''}`;
  }

  const parts: string[] = [];
  if (leader.length > 0) {
    parts.push(
      `Leaders ${leader.slice(0, 8).join(', ')}${leader.length > 8 ? ` (+${leader.length - 8})` : ''}`,
    );
  }
  if (civ.length > 0) {
    parts.push(
      `Civs ${civ.slice(0, 8).join(', ')}${civ.length > 8 ? ` (+${civ.length - 8})` : ''}`,
    );
  }

  return `Ignored: ${parts.join(' • ')}`;
}

function renderLine(
  meta: Readonly<{ gameId: string; emojiId?: string }> | undefined,
  fallbackKey: string,
): string {
  if (!meta) return humanizeKey(fallbackKey);

  const name = meta.gameId;
  const emojiId = meta.emojiId?.trim();
  if (!emojiId) return name;

  return `<:${sanitizeEmojiName(meta.gameId)}:${emojiId}> ${name}`;
}

function formatCountRange(min: number, max?: number): string {
  if (!max || max <= min) return `${min} each`;
  return `${min}-${max} each`;
}

function addSummaryLines(lines: string[], args: Readonly<{
  allocation: DraftAllocation;
  leadersLabel: string;
  civsLabel?: string;
}>): void {
  lines.push(`${args.allocation.groupKind}s: ${args.allocation.groupCount}`);
  lines.push(
    `${args.leadersLabel}: ${formatCountRange(
      args.allocation.leadersPerGroup,
      args.allocation.leadersPerGroupMax,
    )}`,
  );

  if (args.civsLabel && args.allocation.civsPerGroup !== undefined) {
    lines.push(
      `${args.civsLabel}: ${formatCountRange(
        args.allocation.civsPerGroup,
        args.allocation.civsPerGroupMax,
      )}`,
    );
  }

  if (args.allocation.note) {
    lines.push(args.allocation.note);
  }
}

function chunkFieldLines(lines: readonly string[]): string[] {
  const chunks: string[] = [];
  let current = '';

  for (const line of lines) {
    const next = current ? `${current}\n${line}` : line;

    if (next.length <= EMBED_FIELD_VALUE_LIMIT) {
      current = next;
      continue;
    }

    if (current) {
      chunks.push(current);
      current = line;
      continue;
    }

    chunks.push(line.slice(0, EMBED_FIELD_VALUE_LIMIT));
    current = line.slice(EMBED_FIELD_VALUE_LIMIT);
  }

  if (current) {
    chunks.push(current);
  }

  return chunks.length > 0 ? chunks : ['—'];
}

function addGroupFields(args: Readonly<{
  embed: EmbedBuilder;
  groupKind: 'Player' | 'Team';
  groups: readonly DraftGroup[];
  renderGroupLines: (group: DraftGroup) => string[];
}>): void {
  for (let i = 0; i < args.groups.length; i += 1) {
    const fieldNameBase = labelForGroup(args.groupKind, i);
    const chunks = chunkFieldLines(args.renderGroupLines(args.groups[i]));

    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
      args.embed.addFields({
        name: chunkIndex === 0 ? fieldNameBase : `${fieldNameBase} (cont.)`,
        value: chunks[chunkIndex],
        inline: true,
      });
    }
  }
}

export function buildCiv6DraftEmbed(draft: Civ6DraftResult): EmbedBuilder {
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
  const ignoredLine = formatIgnoredLine({
    leader: draft.allocation.ignoredLeaderBans,
  });

  if (bansLine) lines.push(bansLine);
  if (ignoredLine) lines.push(ignoredLine);

  const embed = new EmbedBuilder()
    .setTitle('Draft')
    .setDescription(lines.join('\n'))
    .setColor(0x00ff00);

  addGroupFields({
    embed,
    groupKind: draft.allocation.groupKind,
    groups: draft.groups,
    renderGroupLines: (group) =>
      group.leaders.map((key) => renderLine(lookupCiv6LeaderMeta(key), key)),
  });

  return embed;
}

export function buildCiv7DraftEmbed(draft: Civ7DraftResult): EmbedBuilder {
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

  const embed = new EmbedBuilder()
    .setTitle('Draft')
    .setDescription(lines.join('\n'))
    .setColor(0x00ff00);

  addGroupFields({
    embed,
    groupKind: draft.allocation.groupKind,
    groups: draft.groups,
    renderGroupLines: (group) => {
      const groupLines = ['**Leaders**'];
      groupLines.push(
        ...group.leaders.map((key) => renderLine(lookupCiv7LeaderMeta(key), key)),
      );
      groupLines.push('', '**Civs**');
      groupLines.push(
        ...(group.civs ?? []).map((key) => renderLine(lookupCiv7CivMeta(key), key)),
      );
      return groupLines;
    },
  });

  return embed;
}

export function buildCiv6DirectDraftSummaryEmbed(
  draft: Civ6DraftResult,
): EmbedBuilder {
  const lines: string[] = ['civ6 • standard', `Game Type: ${draft.gameType}`];

  addSummaryLines(lines, {
    allocation: draft.allocation,
    leadersLabel: 'Leaders',
  });

  const bansLine = formatBansLine({
    leaderKeys: draft.allocation.bannedLeaders,
    leaderLookup: lookupCiv6LeaderMeta,
  });
  const ignoredLine = formatIgnoredLine({
    leader: draft.allocation.ignoredLeaderBans,
  });

  if (bansLine) lines.push(bansLine);
  if (ignoredLine) lines.push(ignoredLine);

  return new EmbedBuilder()
    .setTitle('Direct Draft')
    .setDescription(lines.join('\n'))
    .setColor(0x00ff00);
}

export function buildCiv7DirectDraftSummaryEmbed(
  draft: Civ7DraftResult,
): EmbedBuilder {
  const lines: string[] = [
    'civ7 • standard',
    `Game Type: ${draft.gameType}`,
    `Starting Age: ${draft.startingAge}`,
    draft.startingAge === 'None'
      ? 'Civ duplicates across groups: Not allowed'
      : 'Civ duplicates across groups: Allowed',
  ];

  addSummaryLines(lines, {
    allocation: draft.allocation,
    leadersLabel: 'Leaders',
    civsLabel: 'Civs',
  });

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

  return new EmbedBuilder()
    .setTitle('Direct Draft')
    .setDescription(lines.join('\n'))
    .setColor(0x00ff00);
}