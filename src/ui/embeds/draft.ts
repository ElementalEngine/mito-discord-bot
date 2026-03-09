import { EmbedBuilder } from 'discord.js';

import { lookupCiv6LeaderMeta } from '../../data/civ6.data.js';
import { lookupCiv7CivMeta, lookupCiv7LeaderMeta } from '../../data/civ7.data.js';
import type { Civ6DraftResult, Civ7DraftResult, DraftGameType } from '../../types/draft.js';
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
  const line1 = args.game === 'civ6' ? `Civ 6 • ${args.gameType}` : `Civ 7 • ${args.gameType} • ${args.startingAge ?? '—'}`;
  const line2 = args.game === 'civ6'
    ? `Leaders: ${args.leadersPerGroup} each`
    : `Leaders: ${args.leadersPerGroup} each • Civs: ${args.civsPerGroup ?? 0} each`;
  return `${line1}\n${line2}`;
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

export function buildCiv6DraftEmbed(draft: Civ6DraftResult): EmbedBuilder {
  const header = formatHeader({
    game: 'civ6',
    gameType: draft.gameType,
    leadersPerGroup: draft.allocation.leadersPerGroup,
  });

  const lines: string[] = [
    header,
    `Leaders banned: ${renderBanList({ keys: draft.allocation.bannedLeaders, lookup: lookupCiv6LeaderMeta, emptyLabel: 'none' })}`,
  ];

  const ignoredLine = formatIgnoredLine({ leader: draft.allocation.ignoredLeaderBans });
  if (ignoredLine) lines.push(ignoredLine);
  for (let i = 0; i < draft.groups.length; i += 1) {
    lines.push('', `**${labelForGroup(draft.allocation.groupKind, i)}**`);
    for (const key of draft.groups[i].leaders) {
      lines.push(renderLine(lookupCiv6LeaderMeta(key), key));
    }
  }

  return new EmbedBuilder().setTitle('Draft').setDescription(lines.join('\n')).setColor(0x00ff00);
}

export function buildCiv7DraftEmbed(draft: Civ7DraftResult): EmbedBuilder {
  const header = formatHeader({
    game: 'civ7',
    gameType: draft.gameType,
    startingAge: draft.startingAge,
    leadersPerGroup: draft.allocation.leadersPerGroup,
    civsPerGroup: draft.allocation.civsPerGroup,
  });

  const lines: string[] = [
    header,
    `Leaders banned: ${renderBanList({ keys: draft.allocation.bannedLeaders, lookup: lookupCiv7LeaderMeta, emptyLabel: 'none' })}`,
    `Civs banned: ${renderBanList({ keys: draft.allocation.bannedCivs, lookup: lookupCiv7CivMeta, emptyLabel: 'none' })}`,
  ];

  const ignoredLine = formatIgnoredLine({ leader: draft.allocation.ignoredLeaderBans, civ: draft.allocation.ignoredCivBans });
  if (ignoredLine) lines.push(ignoredLine);

  for (let i = 0; i < draft.groups.length; i += 1) {
    const group = draft.groups[i];
    lines.push('', `**${labelForGroup(draft.allocation.groupKind, i)}**`, '**Leaders**');
    for (const key of group.leaders) {
      lines.push(renderLine(lookupCiv7LeaderMeta(key), key));
    }
    lines.push('', '**Civs**');
    for (const key of group.civs ?? []) {
      lines.push(renderLine(lookupCiv7CivMeta(key), key));
    }
  }

  return new EmbedBuilder().setTitle('Draft').setDescription(lines.join('\n')).setColor(0x00ff00);
}

function addGroupSummaryLine(lines: string[], kind: 'Player' | 'Team', count: number): void {
  lines.push(`${kind === 'Team' ? 'Teams' : 'Players'}: ${count}`);
}

export function buildCiv6DirectDraftSummaryEmbed(draft: Civ6DraftResult): EmbedBuilder {
  const lines: string[] = [`Game Type: ${draft.gameType}`];
  addGroupSummaryLine(lines, draft.allocation.groupKind, draft.allocation.groupCount);
  lines.push(`Leaders: ${draft.allocation.leadersPerGroup} per draft`);
  lines.push(`Leaders banned: ${renderBanList({ keys: draft.allocation.bannedLeaders, lookup: lookupCiv6LeaderMeta, emptyLabel: 'none' })}`);

  const ignoredLine = formatIgnoredLine({ leader: draft.allocation.ignoredLeaderBans });
  if (ignoredLine) lines.push(ignoredLine);
  if (draft.allocation.note) lines.push(draft.allocation.note);

  return new EmbedBuilder().setTitle('Direct Draft Civ 6').setDescription(lines.join('\n')).setColor(0x00ff00);
}

export function buildCiv7DirectDraftSummaryEmbed(draft: Civ7DraftResult): EmbedBuilder {
  const lines: string[] = [`Game Type: ${draft.gameType}`, `Starting Age: ${draft.startingAge}`];
  addGroupSummaryLine(lines, draft.allocation.groupKind, draft.allocation.groupCount);
  lines.push(`Leaders: ${draft.allocation.leadersPerGroup} per draft`);
  lines.push(`Civs: ${draft.allocation.civsPerGroup ?? 0} per draft`);
  lines.push(`Leaders banned: ${renderBanList({ keys: draft.allocation.bannedLeaders, lookup: lookupCiv7LeaderMeta, emptyLabel: 'none' })}`);
  lines.push(`Civs banned: ${renderBanList({ keys: draft.allocation.bannedCivs, lookup: lookupCiv7CivMeta, emptyLabel: 'none' })}`);

  const ignoredLine = formatIgnoredLine({ leader: draft.allocation.ignoredLeaderBans, civ: draft.allocation.ignoredCivBans });
  if (ignoredLine) lines.push(ignoredLine);
  if (draft.allocation.note) lines.push(draft.allocation.note);

  return new EmbedBuilder().setTitle('Direct Draft Civ 7').setDescription(lines.join('\n')).setColor(0x00ff00);
}
