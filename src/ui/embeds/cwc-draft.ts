import { EmbedBuilder, userMention } from 'discord.js';

import { EMOJI_LOCK, EMOJI_RANDOM } from '../../config/constants.js';
import type { CivEdition } from '../../config/types.js';
import { formatCiv6Leader, lookupCiv6Leader } from '../../data/civ6.data.js';
import { formatCiv7Civ, formatCiv7Leader, lookupCiv7Civ, lookupCiv7Leader } from '../../data/civ7.data.js';
import type { CwcDraftSession } from '../../types/drafting.types.js';
import { formatDeadlineLine } from '../../services/drafting/runtime/deadline.service.js';

function leaderLine(edition: CivEdition, key: string): string {
  return edition === 'CIV6'
    ? `${formatCiv6Leader(key)} ${lookupCiv6Leader(key)}`
    : `${formatCiv7Leader(key)} ${lookupCiv7Leader(key)}`;
}

function civLine(key: string): string {
  return `${formatCiv7Civ(key)} ${lookupCiv7Civ(key)}`;
}

function captainLine(captainId: string | null): string {
  return captainId ? userMention(captainId) : 'Not selected';
}

function pickOrderText(order: readonly number[]): string {
  return order.map((teamIndex) => String(teamIndex + 1)).join('');
}

function currentCaptainId(session: CwcDraftSession): string | null {
  if (session.round === 'captains' || session.round === 'complete') return null;
  const teamIndex = session.pickOrder[session.turnIndex] ?? 0;
  return session.captainIds[teamIndex] ?? null;
}

function renderTeamLines(session: CwcDraftSession, teamIndex: 0 | 1): string[] {
  const picks = session.picks[teamIndex];
  const lines: string[] = [`**Team ${teamIndex + 1} Captain:** ${captainLine(session.captainIds[teamIndex])}`];
  lines.push('**Leaders**');
  if (picks.leaders.length === 0) lines.push('• —');
  else lines.push(...picks.leaders.map((key) => `• ${leaderLine(session.edition, key)}`));

  if (session.edition === 'CIV7') {
    lines.push('', '**Civs**');
    if (picks.civs.length === 0) lines.push('• —');
    else lines.push(...picks.civs.map((key) => `• ${civLine(key)}`));
  }

  return lines;
}

export function buildCwcCaptainSelectEmbed(args: Readonly<{
  edition: CivEdition;
  startingAge?: string;
  hostId: string;
  teamSize: number;
  captainIds: readonly [string | null, string | null];
  endsAtMs: number;
  lastEvent?: string;
}>): EmbedBuilder {
  const lines: string[] = [
    `Host: ${userMention(args.hostId)}`,
    `Teams: **2v${args.teamSize}**`,
    formatDeadlineLine(args.endsAtMs, { label: 'Captain selection deadline', fixedStyle: 'f' }),
  ];
  if (args.edition === 'CIV7') lines.push(`Starting Age: **${args.startingAge ?? '—'}**`);
  if (args.lastEvent) lines.push('', args.lastEvent);
  lines.push('', `**Team 1 Captain:** ${captainLine(args.captainIds[0])}`);
  lines.push(`**Team 2 Captain:** ${captainLine(args.captainIds[1])}`);
  lines.push('', 'Only the vote host can select captains.');

  return new EmbedBuilder()
    .setTitle('🌍 CWC Draft — Select Captains')
    .setDescription(lines.join('\n'));
}

export function buildCwcDraftStatusEmbed(session: CwcDraftSession): EmbedBuilder {
  const currentTeam = session.round === 'captains' || session.round === 'complete'
    ? null
    : (session.pickOrder[session.turnIndex] ?? 0) + 1;
  const currentCaptain = currentCaptainId(session);
  const lines: string[] = [
    `Teams: **2v${session.voterIds.length / 2}**`,
    `Pick order: **${pickOrderText(session.pickOrder)}**`,
    `Round: **${session.round === 'leader' ? 'Leaders' : 'Civs'}**`,
    `Current turn: **${session.turnIndex + 1}/${session.pickOrder.length}**`,
    `Current team: **Team ${currentTeam ?? 1}**`,
    `Current captain: ${currentCaptain ? userMention(currentCaptain) : '—'}`,
    formatDeadlineLine(session.turnEndsAtMs, { fixedStyle: 'f' }),
  ];
  if (session.edition === 'CIV7') {
    lines.push(`Starting Age: **${session.startingAge ?? '—'}**`);
  }
  if (session.lastEvent) lines.push('', session.lastEvent);
  lines.push('');
  lines.push(...renderTeamLines(session, 0));
  lines.push('', ...renderTeamLines(session, 1));

  return new EmbedBuilder()
    .setTitle('🌍 CWC Draft')
    .setDescription(lines.join('\n'));
}

export function buildCwcDraftCompleteEmbed(session: CwcDraftSession): EmbedBuilder {
  const lines: string[] = [];
  if (session.lastEvent) lines.push(session.lastEvent, '');
  lines.push(...renderTeamLines(session, 0));
  lines.push('', ...renderTeamLines(session, 1));
  return new EmbedBuilder()
    .setTitle(`${EMOJI_LOCK} CWC Draft Complete`)
    .setDescription(lines.join('\n'));
}

export function buildCwcTimeoutEvent(teamIndex: number, edition: CivEdition, round: 'leader' | 'civ', key: string): string {
  if (round === 'leader') {
    return `${EMOJI_RANDOM} Team ${teamIndex + 1} timed out — random leader assigned: ${leaderLine(edition, key)}`;
  }
  return `${EMOJI_RANDOM} Team ${teamIndex + 1} timed out — random civ assigned: ${civLine(key)}`;
}

export function buildCwcCaptainTimeoutEvent(args: Readonly<{ captainIds: readonly [string | null, string | null] }>): string {
  return `${EMOJI_RANDOM} Captain selection timed out — Team 1: ${captainLine(args.captainIds[0])}, Team 2: ${captainLine(args.captainIds[1])}`;
}
