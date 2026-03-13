import { EmbedBuilder, userMention } from 'discord.js';

import { EMOJI_SNAKE } from '../../config/constants.js';
import type { CivEdition } from '../../config/types.js';
import { formatCiv6Leader, lookupCiv6Leader } from '../../data/civ6.data.js';
import { formatCiv7Civ, formatCiv7Leader, lookupCiv7Civ, lookupCiv7Leader } from '../../data/civ7.data.js';
import type { SnakeDraftPick, SnakeRoundKind } from '../../types/drafting.types.js';
import { humanizeGameId } from '../../utils/humanize-game-id.js';
import { formatDeadlineLine } from '../../services/drafting/runtime/deadline.service.js';

function leaderLine(edition: CivEdition, key?: string): string {
  if (!key) return '—';
  return edition === 'CIV6'
    ? `${formatCiv6Leader(key)} ${humanizeGameId(lookupCiv6Leader(key))}`
    : `${formatCiv7Leader(key)} ${humanizeGameId(lookupCiv7Leader(key))}`;
}

function civLine(key?: string): string {
  if (!key) return '—';
  return `${formatCiv7Civ(key)} ${humanizeGameId(lookupCiv7Civ(key))}`;
}

function roundLabel(edition: CivEdition, round: SnakeRoundKind): string {
  if (round === 'leader') return 'Leaders';
  if (round === 'civ') return edition === 'CIV7' ? 'Civs (Reverse Order)' : 'Complete';
  return 'Complete';
}

function voteUuidLine(voteUuid?: string): string | undefined {
  return voteUuid ? `Vote UUID: \`${voteUuid}\`` : undefined;
}

export function buildSnakeDraftWaitingDmEmbed(args: Readonly<{
  edition: CivEdition;
  round: SnakeRoundKind;
  currentPickerId: string | null;
  pick?: SnakeDraftPick;
  voteUuid?: string;
}>): EmbedBuilder {
  const lines: string[] = [];
  if (args.voteUuid) lines.push(voteUuidLine(args.voteUuid)!);
  if (args.currentPickerId) {
    if (lines.length > 0) lines.push('');
    lines.push(`Current picker: ${userMention(args.currentPickerId)}`);
    lines.push(`Round: ${roundLabel(args.edition, args.round)}`);
    lines.push('');
  }
  if (args.edition === 'CIV7') lines.push(`**Civ:** ${civLine(args.pick?.civKey)}`);
  lines.push(`**Leader:** ${leaderLine(args.edition, args.pick?.leaderKey)}`);
  return new EmbedBuilder()
    .setTitle(`${EMOJI_SNAKE} Snake Draft`)
    .setDescription(lines.join('\n'));
}

export function buildSnakeDraftActiveDmEmbed(args: Readonly<{
  edition: CivEdition;
  round: Exclude<SnakeRoundKind, 'complete'>;
  endsAtMs: number;
  pick?: SnakeDraftPick;
  stagedPick?: SnakeDraftPick;
  voteUuid?: string;
}>): EmbedBuilder {
  const current = args.stagedPick ?? args.pick;
  const lines: string[] = [
    args.round === 'leader'
      ? 'Choose your leader below, then press **Submit** to lock it in.'
      : 'Choose your civ below, then press **Submit** to lock it in.',
    voteUuidLine(args.voteUuid),
    formatDeadlineLine(args.endsAtMs, { includeRelative: false }),
    '',
  ].filter((line): line is string => Boolean(line));
  if (args.edition === 'CIV7') lines.push(`**Civ:** ${civLine(current?.civKey)}`);
  lines.push(`**Leader:** ${leaderLine(args.edition, current?.leaderKey)}`);
  lines.push('');
  lines.push(`**Status:** ${args.round === 'leader' ? (current?.leaderKey ? 'Ready to submit' : 'Awaiting leader pick') : (current?.civKey ? 'Ready to submit' : 'Awaiting civ pick')}`);
  return new EmbedBuilder()
    .setTitle(`${EMOJI_SNAKE} Snake Draft`)
    .setDescription(lines.join('\n'));
}

export function buildSnakeDraftStatusEmbed(args: Readonly<{
  edition: CivEdition;
  round: Exclude<SnakeRoundKind, 'complete'>;
  order: readonly string[];
  currentPickerId: string;
  picks: ReadonlyMap<string, SnakeDraftPick>;
  endsAtMs: number;
  lastEvent?: string;
  voteUuid?: string;
}>): EmbedBuilder {
  const lines: string[] = [
    voteUuidLine(args.voteUuid),
    `Round: **${roundLabel(args.edition, args.round)}**`,
    `Current picker: ${userMention(args.currentPickerId)}`,
    formatDeadlineLine(args.endsAtMs, { includeRelative: false }),
  ].filter((line): line is string => Boolean(line));
  if (args.lastEvent) {
    lines.push('', args.lastEvent);
  }
  lines.push('');

  for (const [index, userId] of args.order.entries()) {
    const pick = args.picks.get(userId);
    if (args.round === 'leader') {
      const status = pick?.leaderKey
        ? leaderLine(args.edition, pick.leaderKey)
        : userId === args.currentPickerId
          ? 'Picking now'
          : 'Waiting';
      lines.push(`${index + 1}. ${userMention(userId)} — ${status}`);
      continue;
    }

    const civStatus = pick?.civKey
      ? civLine(pick.civKey)
      : userId === args.currentPickerId
        ? 'Picking now'
        : 'Waiting';
    lines.push(`${index + 1}. ${userMention(userId)} — Leader: ${leaderLine(args.edition, pick?.leaderKey)} | Civ: ${civStatus}`);
  }

  return new EmbedBuilder()
    .setTitle(`${EMOJI_SNAKE} Snake Draft — ${args.edition === 'CIV6' ? 'Civ6' : 'Civ7'}`)
    .setDescription(lines.join('\n'));
}

export function buildSnakeDraftCompleteEmbed(args: Readonly<{
  edition: CivEdition;
  order: readonly string[];
  picks: ReadonlyMap<string, SnakeDraftPick>;
  lastEvent?: string;
  voteUuid?: string;
}>): EmbedBuilder {
  const lines: string[] = [];
  if (args.voteUuid) lines.push(voteUuidLine(args.voteUuid)!);
  if (args.lastEvent) lines.push(args.lastEvent);
  if (lines.length > 0) lines.push('');
  for (const userId of args.order) {
    const pick = args.picks.get(userId);
    if (args.edition === 'CIV6') {
      lines.push(`• ${userMention(userId)} — ${leaderLine(args.edition, pick?.leaderKey)}`);
      continue;
    }
    lines.push(`• ${userMention(userId)} — ${leaderLine(args.edition, pick?.leaderKey)} | ${civLine(pick?.civKey)}`);
  }
  return new EmbedBuilder()
    .setTitle(`${EMOJI_SNAKE} Snake Draft Complete`)
    .setDescription(lines.join('\n'));
}
