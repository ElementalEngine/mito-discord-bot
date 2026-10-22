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

// The marks a seat carries beside its player, and that the staff notes use.
export const MARK = {
  quit: '\u{1f3f3}\ufe0f',
  sub: '\u{1f501}',
  unassigned: '\u2754',
  contest: '\u26a0\ufe0f',
  oversub: '\u203c\ufe0f',
} as const;

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

// Saves store a map file name such as Seven_Seas, or a name already.
export function mapLabel(map: string): string {
  return /_/.test(map) && !/\s/.test(map) ? pretty(map) : map;
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
  return isAssigned(p) ? mention(p.discord_id ?? '') : `\`${p.user_name ?? 'unknown'}\` ${MARK.unassigned}`;
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
const ranked = (match: Match): Seat[] => seatsOf(match).sort((a, b) => placeOf(a) - placeOf(b) || a.index - b.index);

// The player and civ, marked for a quit or a sub-in; then the rating moves.
function seatLines(match: Match, s: Seat, names: CivNames): string {
  const p = s.player;
  const second = match.is_cloud ? p.combined_delta : p.season_delta;
  const marks = `${p.quit ? ` ${MARK.quit}` : ''}${s.leaver ? ` ${MARK.sub}` : ''}`;
  const deltas = [`${signed(p.delta)} lifetime`];
  if (typeof second === 'number') deltas.push(`${signed(second)} ${match.is_cloud ? 'combined' : 'season'}`);
  return `**${placeOf(s)}.** ${who(p)}${marks} \u2014 ${civOf(match, p, names)}\n-# ${deltas.join(' \u00b7 ')}`;
}

function standings(match: Match, names: CivNames): string {
  const seats = ranked(match);
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

// One line a reader should not miss; `holds` lines keep the report orange
// until staff deal with them.
export type Note = Readonly<{ line: string; holds: boolean }>;

function subNote(player: Player, leaver: Player, quota: SubQuota | undefined): Note {
  const sub = `${who(player)} subbed in for ${who(leaver)}`;
  if (!quota) return { line: `${MARK.sub} ${sub}.`, holds: false };
  const nth = quota.count + 1;
  if (nth > quota.limit) {
    const over = `${ordinal(nth)} sub-in in ${quota.window_days} days (limit ${quota.limit}). Oversub applies.`;
    return { line: `${MARK.oversub} ${sub}: ${over}`, holds: true };
  }
  return { line: `${MARK.sub} ${sub} \u00b7 sub-in ${nth} of ${quota.limit} in ${quota.window_days} days.`, holds: false };
}

// Quits and subs in standing order and, while pending, what staff must settle:
// unassigned seats, oversubs and contests.
export function notesOf(match: Match, quotas: Quotas = new Map()): Note[] {
  const pending = !match.approved_at;
  const seats = ranked(match);
  const notes: Note[] = [];
  const unassigned = seats.filter((s) => !isAssigned(s.player)).length;
  if (pending && unassigned) {
    const them = unassigned === 1 ? 'seat is unassigned. Use Edit to assign it.' : 'seats are unassigned. Use Edit to assign them.';
    notes.push({ line: `${MARK.unassigned} ${unassigned} ${them}`, holds: true });
  }
  for (const s of seats) {
    if (s.player.quit) notes.push({ line: `${MARK.quit} ${who(s.player)} quit.`, holds: false });
    if (s.leaver) notes.push(subNote(s.player, s.leaver, pending ? quotas.get(s.player.discord_id ?? '') : undefined));
  }
  if (pending) {
    for (const c of match.contest_report_list) {
      notes.push({ line: `${MARK.contest} Contested by ${mention(c.contestor_discord_id)}: ${c.reason}`, holds: true });
    }
  }
  return notes;
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
// Times are fixed stamps, shown in each reader's own time zone.
export function reportPanel({ match, names, quotas }: ReportView): Panel {
  const approved = Boolean(match.approved_at);
  const facts = [`Match \`${match.match_id}\``, `turn ${match.turn}`, mapLabel(match.map_type), match.age ? ageLabel(match.age) : null];
  const notes = notesOf(match, quotas);
  const body: Block[] = [text(standings(match, names))];
  if (notes.length) {
    const heading = approved ? [] : ['**For staff**'];
    body.push(divider(), text([...heading, ...notes.map((n) => n.line)].join('\n')));
  }
  const reported = `Reported by ${mention(match.reporter_discord_id)} \u00b7 ${when(new Date(match.created_at), 'f')}`;
  return {
    tone: approved ? 'success' : notes.some((n) => n.holds) ? 'refused' : 'info',
    surface: 'report',
    title: `${reportLabel(match)} ${approved ? 'result' : 'report'}`,
    subtitle: facts.filter((x): x is string => Boolean(x)).join(' \u00b7 '),
    body,
    ...(approved ? {} : { actions: [reportButtons(match.match_id)] }),
    footer:
      approved && match.approver_discord_id && match.approved_at
        ? `${reported} \u00b7 approved by ${mention(match.approver_discord_id)} \u00b7 ${when(new Date(match.approved_at), 'f')}`
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
