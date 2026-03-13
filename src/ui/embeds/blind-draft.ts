import { EmbedBuilder, userMention } from 'discord.js';

import { EMOJI_LOCK } from '../../config/constants.js';
import type { CivEdition } from '../../config/types.js';
import { formatCiv6Leader, lookupCiv6Leader } from '../../data/civ6.data.js';
import { formatCiv7Civ, formatCiv7Leader, lookupCiv7Civ, lookupCiv7Leader } from '../../data/civ7.data.js';
import type { BlindDraftPick } from '../../types/drafting.types.js';
import { humanizeGameId } from '../../utils/humanize-game-id.js';

function ts(ms: number, style: 't' | 'R'): string {
  return `<t:${Math.floor(ms / 1000)}:${style}>`;
}

function deadlineLine(ms: number): string {
  return `Deadline: ${ts(ms, 't')} (${ts(ms, 'R')})`;
}

function leaderLine(edition: CivEdition, key?: string): string {
  if (!key) return 'Not selected';
  return edition === 'CIV6'
    ? `${formatCiv6Leader(key)} ${humanizeGameId(lookupCiv6Leader(key))}`
    : `${formatCiv7Leader(key)} ${humanizeGameId(lookupCiv7Leader(key))}`;
}

function civLine(key?: string): string {
  if (!key) return 'Not selected';
  return `${formatCiv7Civ(key)} ${humanizeGameId(lookupCiv7Civ(key))}`;
}

function activeStatusLine(edition: CivEdition, pick?: BlindDraftPick, stagedPick?: BlindDraftPick): string {
  const current = stagedPick ?? pick;
  if (edition === 'CIV6') {
    if (pick?.leaderKey) return 'Submitted';
    return current?.leaderKey ? 'Ready to submit' : 'Awaiting leader pick';
  }

  if (pick?.leaderKey && pick?.civKey) return 'Submitted';

  const hasLeader = Boolean(current?.leaderKey);
  const hasCiv = Boolean(current?.civKey);
  if (hasLeader && hasCiv) return 'Ready to submit';
  if (hasLeader) return 'Awaiting civ pick';
  if (hasCiv) return 'Awaiting leader pick';
  return 'Awaiting leader & civ pick';
}

function timeoutStatusLine(edition: CivEdition, pick?: BlindDraftPick): string {
  if (edition === 'CIV6') {
    return pick?.leaderKey ? 'Picked' : 'No pick submitted';
  }

  const hasLeader = Boolean(pick?.leaderKey);
  const hasCiv = Boolean(pick?.civKey);
  if (hasLeader && hasCiv) return 'Picked';
  if (hasLeader || hasCiv) return 'Partial pick submitted';
  return 'No pick submitted';
}

function voteUuidLine(voteUuid?: string): string | undefined {
  return voteUuid ? `Vote UUID: \`${voteUuid}\`` : undefined;
}

export function buildBlindDraftEmbed(args: Readonly<{
  edition: CivEdition;
  pick?: BlindDraftPick;
  stagedPick?: BlindDraftPick;
  endsAtMs: number;
  voteUuid?: string;
}>): EmbedBuilder {
  const lines: string[] = [
    'Choose your blind draft picks below, then press **Submit** to lock them in.',
    voteUuidLine(args.voteUuid),
    deadlineLine(args.endsAtMs),
    '',
  ].filter((line): line is string => Boolean(line));

  if (args.edition === 'CIV7') {
    lines.push(`**Civ:** ${civLine((args.stagedPick ?? args.pick)?.civKey)}`);
  }
  lines.push(`**Leader:** ${leaderLine(args.edition, (args.stagedPick ?? args.pick)?.leaderKey)}`);
  lines.push('');
  lines.push(`**Status:** ${activeStatusLine(args.edition, args.pick, args.stagedPick)}`);

  return new EmbedBuilder()
    .setTitle(`${EMOJI_LOCK} Blind Draft`)
    .setDescription(lines.join('\n'));
}

export function buildBlindDraftClosedEmbed(args: Readonly<{
  edition: CivEdition;
  pick?: BlindDraftPick;
  reason: 'timeout' | 'complete';
  voteUuid?: string;
}>): EmbedBuilder {
  const lines: string[] = [
    args.reason === 'timeout' ? 'Blind draft closed due to timeout.' : 'Blind draft completed.',
    voteUuidLine(args.voteUuid),
    '',
  ].filter((line): line is string => Boolean(line));

  if (args.edition === 'CIV7') {
    lines.push(`**Civ:** ${civLine(args.pick?.civKey)}`);
  }
  lines.push(`**Leader:** ${leaderLine(args.edition, args.pick?.leaderKey)}`);
  lines.push('');
  lines.push(`**Status:** ${timeoutStatusLine(args.edition, args.pick)}`);

  return new EmbedBuilder()
    .setTitle(`${EMOJI_LOCK} Blind Draft`)
    .setDescription(lines.join('\n'));
}

export function buildBlindDraftTrackingEmbed(args: Readonly<{
  edition: CivEdition;
  voterIds: readonly string[];
  picks: ReadonlyMap<string, BlindDraftPick>;
  stagedPicks?: ReadonlyMap<string, BlindDraftPick>;
  endsAtMs: number;
  voteUuid?: string;
}>): EmbedBuilder {
  const lines = args.voterIds.map((id) => `• ${userMention(id)} — ${activeStatusLine(args.edition, args.picks.get(id), args.stagedPicks?.get(id))}`);
  return new EmbedBuilder()
    .setTitle(`${EMOJI_LOCK} Blind Draft Status`)
    .setDescription([
      voteUuidLine(args.voteUuid),
      deadlineLine(args.endsAtMs),
      '',
      ...lines,
    ].filter((line): line is string => Boolean(line)).join('\n'));
}

export function buildBlindDraftRevealEmbed(args: Readonly<{
  edition: CivEdition;
  voterIds: readonly string[];
  picks: ReadonlyMap<string, BlindDraftPick>;
  voteUuid?: string;
}>): EmbedBuilder {
  const lines: string[] = [];
  if (args.voteUuid) lines.push(voteUuidLine(args.voteUuid)!);
  if (lines.length > 0) lines.push('');
  for (const id of args.voterIds) {
    const pick = args.picks.get(id);
    if (args.edition === 'CIV6') {
      lines.push(`• ${userMention(id)} — ${leaderLine(args.edition, pick?.leaderKey)}`);
      continue;
    }
    lines.push(
      `• ${userMention(id)} — ${civLine(pick?.civKey)} | ${leaderLine(args.edition, pick?.leaderKey)}`,
    );
  }

  return new EmbedBuilder()
    .setTitle(`${EMOJI_LOCK} Blind Draft Reveal`)
    .setDescription(lines.join('\n'));
}

export function buildBlindDraftTimeoutEmbed(args: Readonly<{
  edition: CivEdition;
  voterIds: readonly string[];
  picks: ReadonlyMap<string, BlindDraftPick>;
  voteUuid?: string;
}>): EmbedBuilder {
  const lines: string[] = [];
  if (args.voteUuid) lines.push(voteUuidLine(args.voteUuid)!);
  if (lines.length > 0) lines.push('');
  lines.push(...args.voterIds.map((id) => `• ${userMention(id)} — ${timeoutStatusLine(args.edition, args.picks.get(id))}`));

  return new EmbedBuilder()
    .setTitle(`${EMOJI_LOCK} Blind Draft Closed`)
    .setDescription(lines.join('\n'));
}
