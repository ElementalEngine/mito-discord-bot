import { ActionRowBuilder, ButtonBuilder, ButtonStyle, type MessageActionRowComponentBuilder } from 'discord.js';

import type { Match, MatchUpload, SubQuota } from '../../api/types.js';
import {
  customId,
  divider,
  mention,
  nameOf,
  plainNameOf,
  pretty,
  signed,
  text,
  when,
  type Block,
  type ButtonRow,
  type CivNames,
  type Panel,
} from '../kit/index.js';

type Player = Match['players'][number];

export type ReportVerb = 'edit' | 'contest' | 'approve';
export const reportId = (verb: ReportVerb, matchId: string): string => customId('report', verb, matchId);

const SNOWFLAKE = /^\d{15,20}$/;
export const isAssigned = (p: Player): boolean => SNOWFLAKE.test(p.discord_id ?? '');

export function isTeamer(match: Match): boolean {
  return match.game_mode.toLowerCase().includes('team');
}

// "Civ6 FFA", "Civ7 PBC Teamer"; the stored mode may carry a pbc- prefix.
export function reportLabel(match: Match): string {
  const mode = match.game_mode.toLowerCase().replace(/^pbc-/, '');
  const shown = isTeamer(match) ? 'Teamer' : mode === 'duel' ? 'Duel' : 'FFA';
  return `${match.game.toLowerCase() === 'civ7' ? 'Civ7' : 'Civ6'} ${match.is_cloud ? 'PBC ' : ''}${shown}`;
}

// Saves store an age token; older documents hold a display name.
export function ageLabel(age: string): string {
  return /^AGE_/.test(age) ? pretty(age.replace(/^AGE_/, '')) : age;
}

export function ordinal(n: number): string {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${suffix}`;
}

function who(p: Player): string {
  return isAssigned(p) ? mention(p.discord_id ?? '') : `\`${p.user_name ?? 'unknown'}\``;
}

function civOf(match: Match, p: Player, names: CivNames): string {
  const leader = p.leader ?? p.civ;
  if (match.game.toLowerCase() !== 'civ7') return nameOf(names, leader);
  return p.leader ? `${nameOf(names, p.leader)} \u00b7 ${plainNameOf(names, p.civ)}` : nameOf(names, p.civ);
}

// Each seat that played, with the player it replaced when it came in as a sub.
type Seat = Readonly<{ index: number; player: Player; leaver: Player | null }>;

export function seatsOf(match: Match): Seat[] {
  return match.players.flatMap((player, index) => {
    if (player.subbed_out) return [];
    const next = match.players[index + 1];
    return [{ index, player, leaver: next?.subbed_out ? next : null }];
  });
}

const placeOf = (s: Seat): number => (s.player.placement ?? 99) + 1;

function seatLines(match: Match, s: Seat, names: CivNames): string {
  const p = s.player;
  const second = match.is_cloud ? p.combined_delta : p.season_delta;
  const meta = [
    `${signed(p.delta)} lifetime`,
    typeof second === 'number' ? `${signed(second)} ${match.is_cloud ? 'combined' : 'season'}` : null,
    isAssigned(p) ? null : 'unassigned',
    p.quit ? 'quit' : null,
    s.leaver ? `sub for ${who(s.leaver)}` : null,
  ].filter((x): x is string => x !== null);
  return `**${placeOf(s)}.** ${who(p)} \u2014 ${civOf(match, p, names)}\n-# ${meta.join(' \u00b7 ')}`;
}

function standings(match: Match, names: CivNames): string {
  const seats = seatsOf(match).sort((a, b) => placeOf(a) - placeOf(b) || a.index - b.index);
  if (!isTeamer(match)) return seats.map((s) => seatLines(match, s, names)).join('\n');
  const teams = new Map<number, Seat[]>();
  for (const s of seats) teams.set(s.player.team, [...(teams.get(s.player.team) ?? []), s]);
  return [...teams.entries()]
    .sort(([, a], [, b]) => placeOf(a[0]!) - placeOf(b[0]!))
    .map(([team, members]) => [
      `**Team ${team + 1}** \u00b7 ${ordinal(placeOf(members[0]!))}`,
      ...members.map((s) => seatLines(match, s, names)),
    ].join('\n'))
    .join('\n\n');
}

// Sub-ins already approved in the window, keyed by the sub's discord id.
export type Quotas = ReadonlyMap<string, SubQuota>;

// What staff should look at before approving. Empty when nothing needs it.
export function attentionOf(match: Match, quotas: Quotas = new Map()): string[] {
  const out: string[] = [];
  const unassigned = seatsOf(match).filter((s) => !isAssigned(s.player)).length;
  if (unassigned) out.push(`${unassigned} seat${unassigned === 1 ? '' : 's'} unassigned. Use Edit to assign ${unassigned === 1 ? 'it' : 'them'}.`);
  for (const s of seatsOf(match)) {
    const quota = s.leaver ? quotas.get(s.player.discord_id ?? '') : undefined;
    if (quota && quota.count + 1 > quota.limit) {
      out.push(`${who(s.player)}: ${ordinal(quota.count + 1)} sub-in in ${quota.window_days} days (limit ${quota.limit}). Oversub applies.`);
    }
  }
  for (const c of match.contest_report_list) out.push(`Contested by ${mention(c.contestor_discord_id)}: ${c.reason}`);
  return out;
}

export function reportButtons(matchId: string): ButtonRow {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder().setCustomId(reportId('edit', matchId)).setLabel('Edit').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(reportId('contest', matchId)).setLabel('Contest').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(reportId('approve', matchId)).setLabel('Approve').setStyle(ButtonStyle.Success),
  );
}

export type ReportView = Readonly<{ match: Match; names: CivNames; quotas?: Quotas }>;

// One message per report: pending with its buttons, then approved without.
export function reportPanel({ match, names, quotas }: ReportView): Panel {
  const approved = Boolean(match.approved_at);
  const facts = [`Match \`${match.match_id}\``, `turn ${match.turn}`, match.map_type, match.age ? ageLabel(match.age) : null];
  const attention = approved ? [] : attentionOf(match, quotas);
  const body: Block[] = [text(standings(match, names))];
  if (attention.length) body.push(divider(), text(attention.map((line) => `\u26a0\ufe0f ${line}`).join('\n')));
  const reported = `Reported by ${mention(match.reporter_discord_id)} ${when(new Date(match.created_at), 'R')}`;
  return {
    tone: approved ? 'success' : attention.length ? 'refused' : 'info',
    surface: 'report',
    title: `${reportLabel(match)} ${approved ? 'result' : 'report'}`,
    subtitle: facts.filter((x): x is string => Boolean(x)).join(' \u00b7 '),
    body,
    ...(approved ? {} : { actions: [reportButtons(match.match_id)] }),
    footer:
      approved && match.approver_discord_id && match.approved_at
        ? `${reported} \u00b7 approved by ${mention(match.approver_discord_id)} ${when(new Date(match.approved_at), 'R')}`
        : reported,
  };
}

// The three ways an upload can already exist, said so the reporter knows
// whether there is anything left to do.
export function duplicateText(upload: MatchUpload): string {
  const id = `\`${upload.match_id}\``;
  if (upload.repeated_by === 'composition') {
    return `This game was already reported from another save, as match ${id}. Edit that report instead.`;
  }
  if (upload.approved_at) return `This save was already reported and approved, as match ${id}.`;
  return `This save is already reported, as match ${id}, and is waiting for approval.`;
}

// What a revert leaves behind: whose ratings were restored.
export function revertedPanel(match: Match): Panel {
  const players = seatsOf(match).map((s) => who(s.player)).join(' \u00b7 ');
  return {
    tone: 'muted',
    surface: 'report',
    title: `${reportLabel(match)} result reverted`,
    subtitle: `Match \`${match.match_id}\``,
    body: [text(`Ratings are restored for ${players}.`)],
  };
}

// The players an approved result pings, as v1's history post did.
export function playerIds(match: Match): string[] {
  return [...new Set(match.players.filter(isAssigned).map((p) => p.discord_id ?? ''))];
}
