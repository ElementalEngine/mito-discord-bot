import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  CheckboxBuilder,
  LabelBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  type MessageActionRowComponentBuilder,
} from 'discord.js';

import type { Match, SeatEdit } from '../../api/types.js';
import { customId, fit, mention, plainNameOf, text, type CivNames, type Panel } from '../kit/index.js';
import { MARK, isAssigned, isTeamer, ordinal, reportLabel, seatsOf } from './report.js';

// The editor's verbs and the form fields they read.
export const EDIT = {
  seat: 'seat',
  seatForm: 'seatform',
  order: 'order',
  orderForm: 'orderform',
  assign: 'assign',
  assignForm: 'assignform',
} as const;
export const FIELD = { player: 'player', quit: 'quit', left: 'left', order: 'order' } as const;

// A form holds five fields, so players are assigned five seats at a time.
const PAGE = 5;

// Discord id -> the member's server name, for forms, where mentions do not
// render.
export type Members = ReadonlyMap<string, string>;

type Seat = ReturnType<typeof seatsOf>[number];
type Numbered = Seat & { n: number };

// Seats are numbered 1..n in the order the save lists them, and controls name
// seats by that number: a sub's row never shifts it. core-api takes the row index.
const numbered = (match: Match): Numbered[] => seatsOf(match).map((s, i) => ({ ...s, n: i + 1 }));

const idOf = (p: Seat['player'] | null): string | null => (p && isAssigned(p) ? (p.discord_id ?? null) : null);
const civOf = (s: Seat, names: CivNames): string => plainNameOf(names, s.player.leader ?? s.player.civ);
const saveName = (p: Seat['player']): string => p.user_name ?? 'unknown';

// A seat's player as a form shows it: the member's server name, else the
// name in the save, marked unassigned.
function nameIn(p: Seat['player'], members: Members): string {
  const id = idOf(p);
  if (!id) return `${saveName(p)} (unassigned)`;
  return members.get(id) ?? saveName(p);
}

function seatLine(match: Match, s: Numbered, names: CivNames): string {
  const p = s.player;
  const id = idOf(p);
  const who = id ? mention(id) : `\`${saveName(p)}\` ${MARK.unassigned}`;
  const left = s.leaver ? (idOf(s.leaver) ? mention(idOf(s.leaver) ?? '') : `\`${saveName(s.leaver)}\``) : null;
  const facts = [
    civOf(s, names),
    ordinal((p.placement ?? 0) + 1),
    isTeamer(match) ? `team ${p.team + 1}` : null,
    p.quit ? `${MARK.quit} quit` : null,
    left ? `${MARK.sub} for ${left}` : null,
  ].filter((x): x is string => x !== null);
  return `\`${s.n}\` ${who} \u2014 ${facts.join(' \u00b7 ')}`;
}

const pagesOf = (match: Match): Numbered[][] => {
  const seats = numbered(match);
  return Array.from({ length: Math.ceil(seats.length / PAGE) }, (_, i) => seats.slice(i * PAGE, i * PAGE + PAGE));
};

const rangeOf = (seats: readonly Numbered[]): string => `${seats[0]?.n ?? 0}\u2013${seats.at(-1)?.n ?? 0}`;

// The private panel the reporter or staff edits a report from: one seat at
// a time from the menu, players five seats at a time, or the whole order.
export function editorPanel(match: Match, names: CivNames, members: Members, asStaff: boolean): Panel {
  const seats = numbered(match);
  const pages = pagesOf(match);
  const pick = new StringSelectMenuBuilder()
    .setCustomId(customId('report', EDIT.seat, match.match_id))
    .setPlaceholder('Edit one seat: player, quit or sub\u2026')
    .addOptions(
      seats.map((s) => ({
        label: fit(`${s.n}. ${nameIn(s.player, members)}`, 100),
        description: fit(civOf(s, names), 100),
        value: String(s.n),
      })),
    );
  const buttons = [
    new ButtonBuilder()
      .setCustomId(customId('report', EDIT.order, match.match_id))
      .setLabel('Set order')
      .setStyle(ButtonStyle.Primary),
    ...pages.map((page, i) =>
      new ButtonBuilder()
        .setCustomId(customId('report', EDIT.assign, match.match_id, String(i)))
        .setLabel(pages.length === 1 ? 'Assign players' : `Assign ${rangeOf(page)}`)
        .setStyle(ButtonStyle.Secondary),
    ),
  ];
  const rows = [new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(pick)];
  for (let i = 0; i < buttons.length; i += 5) {
    rows.push(new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(buttons.slice(i, i + 5)));
  }
  return {
    tone: 'info',
    surface: 'report',
    title: `Edit ${reportLabel(match)} report`,
    subtitle: `Match \`${match.match_id}\` \u00b7 editing as ${asStaff ? 'staff' : 'the reporter'}`,
    body: [text(seats.map((s) => seatLine(match, s, names)).join('\n'))],
    actions: rows,
    footer: asStaff ? 'Staff may set ties and edit any report.' : 'Ties are set by staff.',
  };
}

// The field that holds a seat's player in the assign form.
const seatField = (n: number): string => `seat${n}`;

// Up to five seats, each named by its civ and the name in the save, with the
// player who holds it now already picked.
export function assignForm(match: Match, names: CivNames, page: number): ModalBuilder | null {
  const pages = pagesOf(match);
  const seats = pages[page];
  if (!seats) return null;
  const labels = seats.map((s) => {
    const pickPlayer = new UserSelectMenuBuilder()
      .setCustomId(seatField(s.n))
      .setMinValues(0)
      .setMaxValues(1)
      .setRequired(false);
    const id = idOf(s.player);
    if (id) pickPlayer.setDefaultUsers(id);
    return new LabelBuilder()
      .setLabel(fit(`Seat ${s.n} \u00b7 ${civOf(s, names)}`, 45))
      .setDescription(fit(s.player.user_name ? `In the save: ${s.player.user_name}` : 'No player name in the save', 100))
      .setUserSelectMenuComponent(pickPlayer);
  });
  return new ModalBuilder()
    .setCustomId(customId('report', EDIT.assignForm, match.match_id, String(page)))
    .setTitle(pages.length === 1 ? 'Assign players' : `Assign players: seats ${rangeOf(seats)}`)
    .addLabelComponents(...labels);
}

// One edit per seat whose player changed. An emptied field leaves the seat
// as it is: a seat is never unassigned.
export function assignEdits(match: Match, page: number, picked: (field: string) => string | null): SeatEdit[] {
  return (pagesOf(match)[page] ?? []).flatMap((s) => {
    const id = picked(seatField(s.n));
    return id && id !== idOf(s.player) ? [{ seat: s.index, discord_id: id }] : [];
  });
}

// One seat's whole state in one form: who played it, whether they quit, and
// who they replaced if they came in as a sub.
export function seatForm(match: Match, n: number, members: Members): ModalBuilder | null {
  const seat = numbered(match).find((s) => s.n === n);
  if (!seat) return null;
  const player = new UserSelectMenuBuilder().setCustomId(FIELD.player).setMinValues(1).setMaxValues(1).setRequired(true);
  const playerId = idOf(seat.player);
  if (playerId) player.setDefaultUsers(playerId);
  const left = new UserSelectMenuBuilder().setCustomId(FIELD.left).setMinValues(0).setMaxValues(1).setRequired(false);
  const leftId = idOf(seat.leaver);
  if (leftId) left.setDefaultUsers(leftId);
  return new ModalBuilder()
    .setCustomId(customId('report', EDIT.seatForm, match.match_id, String(n)))
    .setTitle(fit(`Seat ${seat.n}: ${nameIn(seat.player, members)}`, 45))
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('Player')
        .setDescription('Who played this seat to the end.')
        .setUserSelectMenuComponent(player),
      new LabelBuilder()
        .setLabel('Quit')
        .setDescription('Tick if this player quit the game.')
        .setCheckboxComponent(new CheckboxBuilder().setCustomId(FIELD.quit).setDefault(seat.player.quit)),
      new LabelBuilder()
        .setLabel('Came in for')
        .setDescription('The player who left, if this seat was taken over by a sub.')
        .setUserSelectMenuComponent(left),
    );
}

export type SeatChoice = Readonly<{ player: string | null; quit: boolean; left: string | null }>;

// Only what changed is sent; an empty "came in for" leaves an unregistered
// leaver as it is. A player picked from another seat swaps with this one.
export function seatEdits(match: Match, n: number, chosen: SeatChoice): SeatEdit[] {
  const seats = numbered(match);
  const seat = seats.find((s) => s.n === n);
  if (!seat) return [];
  const edit: SeatEdit = { seat: seat.index };
  const swap: SeatEdit[] = [];
  const current = idOf(seat.player);
  if (chosen.player && chosen.player !== current) {
    edit.discord_id = chosen.player;
    const other = seats.find((s) => s !== seat && idOf(s.player) === chosen.player);
    if (other && current) swap.push({ seat: other.index, discord_id: current });
  }
  if (chosen.quit !== seat.player.quit) edit.quit = chosen.quit;
  const before = idOf(seat.leaver);
  if (chosen.left && chosen.left !== before) edit.sub_out = chosen.left;
  else if (!chosen.left && before) edit.sub_out = null;
  return Object.keys(edit).length > 1 ? [edit, ...swap] : [];
}

// What the order is written in: seat numbers, or team numbers for a teamer.
function unitOf(match: Match, s: Numbered): number {
  return isTeamer(match) ? s.player.team + 1 : s.n;
}

// The current order, best first, with ties joined by "=".
export function orderOf(match: Match): string {
  const byPlace = new Map<number, Set<number>>();
  for (const s of numbered(match)) {
    const place = s.player.placement ?? 0;
    byPlace.set(place, (byPlace.get(place) ?? new Set()).add(unitOf(match, s)));
  }
  return [...byPlace.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, units]) => [...units].sort((a, b) => a - b).join('='))
    .join(' ');
}

export type ParsedOrder = Readonly<{ ok: true; seats: SeatEdit[] }> | Readonly<{ ok: false; reason: string }>;

// "3 1=2 4": every seat (or team) once, best first, "=" for a tie. The
// placement is the group's position, as core-api counts it.
export function parseOrder(match: Match, input: string): ParsedOrder {
  const word = isTeamer(match) ? 'team' : 'seat';
  const groups = input.trim().split(/\s+/).filter(Boolean).map((g) => g.split('='));
  if (groups.flat().some((t) => !/^\d+$/.test(t))) {
    return { ok: false, reason: `Write ${word} numbers separated by spaces, best first, such as 3 1 2 4.` };
  }
  const place = new Map<number, number>();
  const repeated = new Set<number>();
  groups.forEach((g, i) => g.map(Number).forEach((u) => (place.has(u) ? repeated.add(u) : place.set(u, i))));
  const seats = numbered(match);
  const units = new Set(seats.map((s) => unitOf(match, s)));
  const missing = [...units].filter((u) => !place.has(u));
  const unknown = [...place.keys()].filter((u) => !units.has(u));
  const problems = [
    missing.length ? `missing ${missing.join(', ')}` : null,
    repeated.size ? `repeated ${[...repeated].join(', ')}` : null,
    unknown.length ? `no ${word} ${unknown.join(', ')}` : null,
  ].filter((x): x is string => x !== null);
  if (problems.length) return { ok: false, reason: `List every ${word} once: ${problems.join('; ')}.` };
  return { ok: true, seats: seats.map((s) => ({ seat: s.index, placement: place.get(unitOf(match, s)) ?? 0 })) };
}

// The key beside the order field: each seat (or team) by number, with who
// holds it now and their civ, in the current finishing order.
function orderKey(match: Match, names: CivNames, members: Members): string[] {
  const seats = numbered(match).sort((a, b) => (a.player.placement ?? 0) - (b.player.placement ?? 0) || a.n - b.n);
  if (!isTeamer(match)) {
    return seats.map((s) => `\`${s.n}\` ${nameIn(s.player, members)} \u2014 ${civOf(s, names)}`);
  }
  const teams = new Map<number, string[]>();
  for (const s of seats) teams.set(s.player.team, [...(teams.get(s.player.team) ?? []), nameIn(s.player, members)]);
  return [...teams.entries()].map(([team, players]) => `**Team ${team + 1}**: ${players.join(', ')}`);
}

export function orderForm(match: Match, names: CivNames, members: Members): ModalBuilder {
  const input = new TextInputBuilder()
    .setCustomId(FIELD.order)
    .setStyle(TextInputStyle.Short)
    .setValue(orderOf(match))
    .setMaxLength(100)
    .setRequired(true);
  return new ModalBuilder()
    .setCustomId(customId('report', EDIT.orderForm, match.match_id))
    .setTitle('Set the finishing order')
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(fit(orderKey(match, names, members).join('\n'), 3000)))
    .addLabelComponents(
      new LabelBuilder()
        .setLabel(isTeamer(match) ? 'Teams, first place first' : 'Seats, first place first')
        .setDescription('Separate with spaces; join a tie with =, as in 3 1=2 4. Ties are for staff.')
        .setTextInputComponent(input),
    );
}
