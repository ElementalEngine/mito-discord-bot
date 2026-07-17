import { EmbedBuilder } from 'discord.js';

import { lookupCiv6LeaderMeta } from '../../../data/civ6.data.js';
import {
  lookupCiv7CivMeta,
  lookupCiv7LeaderMeta,
} from '../../../data/civ7.data.js';
import type {
  Civ6DraftResult,
  Civ7DraftResult,
  DraftAllocation,
} from '../../../shared/draft.types.js';
import { renderEmojiReadableLine } from '../labels.js';

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
    .map((key) => renderEmojiReadableLine(args.lookup(key), key));

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
  const seenCivs = new Set<string>();
  let hasDuplicateCivsAcrossGroups = false;

  for (const group of draft.groups) {
    for (const civKey of group.civs ?? []) {
      if (seenCivs.has(civKey)) {
        hasDuplicateCivsAcrossGroups = true;
        break;
      }
      seenCivs.add(civKey);
    }

    if (hasDuplicateCivsAcrossGroups) break;
  }

  const lines: string[] = [
    'civ7 • standard',
    `Game Type: ${draft.gameType}`,
    `Starting Age: ${draft.startingAge}`,
    hasDuplicateCivsAcrossGroups
      ? 'Civ duplicates across groups: Allowed'
      : 'Civ duplicates across groups: Not allowed',
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
