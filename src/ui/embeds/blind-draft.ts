import { EmbedBuilder } from 'discord.js';

import { EMOJI_LOCK } from '../../config/constants.js';
import type { CivEdition } from '../../config/types.js';
import { CIV6_LEADERS } from '../../data/civ6.data.js';
import { CIV7_CIVS, CIV7_LEADERS } from '../../data/civ7.data.js';
import type { BlindDraftPick } from '../../types/drafting.types.js';

function fmtTimeOnly(ms: number): string {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(ms));
}

function leaderName(edition: CivEdition, key?: string): string {
  if (!key) return 'Not selected';
  return edition === 'CIV6'
    ? CIV6_LEADERS[key as keyof typeof CIV6_LEADERS]?.gameId ?? key
    : CIV7_LEADERS[key as keyof typeof CIV7_LEADERS]?.gameId ?? key;
}

function civName(key?: string): string {
  if (!key) return 'Not selected';
  return CIV7_CIVS[key as keyof typeof CIV7_CIVS]?.gameId ?? key;
}

export function buildBlindDraftEmbed(args: Readonly<{
  edition: CivEdition;
  pick?: BlindDraftPick;
  endsAtMs: number;
}>): EmbedBuilder {
  const lines: string[] = [
    'Choose your blind draft picks below.',
    `Deadline: **${fmtTimeOnly(args.endsAtMs)}**`,
    '',
  ];

  if (args.edition === 'CIV7') {
    lines.push(`**Civ:** ${civName(args.pick?.civKey)}`);
  }
  lines.push(`**Leader:** ${leaderName(args.edition, args.pick?.leaderKey)}`);

  return new EmbedBuilder()
    .setTitle(`${EMOJI_LOCK} Blind Draft`)
    .setDescription(lines.join('\n'));
}

export function buildBlindDraftClosedEmbed(args: Readonly<{
  edition: CivEdition;
  pick?: BlindDraftPick;
  reason: 'timeout' | 'complete';
}>): EmbedBuilder {
  const lines: string[] = [
    args.reason === 'timeout' ? 'Blind draft closed due to timeout.' : 'Blind draft completed.',
    '',
  ];

  if (args.edition === 'CIV7') {
    lines.push(`**Civ:** ${civName(args.pick?.civKey)}`);
  }
  lines.push(`**Leader:** ${leaderName(args.edition, args.pick?.leaderKey)}`);
  if (args.pick?.defaulted) {
    lines.push('', '*One or more choices were defaulted.*');
  }

  return new EmbedBuilder()
    .setTitle(`${EMOJI_LOCK} Blind Draft`)
    .setDescription(lines.join('\n'));
}
