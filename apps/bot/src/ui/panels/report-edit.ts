import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  CheckboxBuilder,
  LabelBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  UserSelectMenuBuilder,
  type APISelectMenuOption,
  type MessageActionRowComponentBuilder,
} from 'discord.js';

import type { Match, SeatEdit } from '../../api/types.js';
import { customId, fit, iconOf, mention, plainNameOf, portraitOf, text, type CivNames, type Panel } from '../kit/index.js';
import { MARK, isAssigned, isTeamer, ordinal, reportLabel, seatsOf } from './report.js';

// The editor's verbs and the form fields they read.
export const EDIT = {
  seat: 'seat',
  seatForm: 'seatform',
  assign: 'assign',
  assignForm: 'assignform',
  order: 'order',
  orderForm: 'orderform',
  tie: 'tie',
  tieForm: 'tieform',
} as const;
export const FIELD = { player: 'player', quit: 'quit', left: 'left', place: 'place', tied: 'tied' } as const;

// A form holds five fields, so seats and places come five to a form.
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
const leaderOf = (s: Seat): string => s.player.leader ?? s.player.civ;
const saveName = (p: Seat['player']): string => p.user_name ?? 'unknown';
const pagesOf = <T>(items: readonly T[]): T[][] =>
  Array.from({ length: Math.ceil(items.length / PAGE) }, (_, i) => items.slice(i * PAGE, i * PAGE + PAGE));
const rangeOf = (first: number, count: number): string => `${first}\u2013${first + count - 1}`;

// A seat's player as a form shows it: the member's server name, else the
// name in the save, marked unassigned.
function nameIn(p: Seat['player'], members: Members): string {
  const id = idOf(p);
  if (!id) return `${saveName(p)} (unassigned)`;
  return members.get(id) ?? saveName(p);
}

// What is ordered: each seat, or each team in a teamer, best first as it stands.
type Unit = Readonly<{ id: number; seats: readonly Numbered[] }>;

function unitsOf(match: Match): Unit[] {
  const seats = numbered(match);
  const units = isTeamer(match)
    ? [...new Set(seats.map((s) => s.player.team))].map((t) => ({ id: t + 1, seats: seats.filter((s) => s.player.team === t) }))
    : seats.map((s) => ({ id: s.n, seats: [s] }));
  const place = (u: Unit): number => u.seats[0]?.player.placement ?? 99;
  return units.sort((a, b) => place(a) - place(b) || a.id - b.id);
}

function seatOption(s: Numbered, names: CivNames, members: Members): APISelectMenuOption {
  const emoji = portraitOf(names, leaderOf(s));
  return {
    label: fit(`${s.n}. ${nameIn(s.player, members)}`, 100),
    description: fit(plainNameOf(names, leaderOf(s)), 100),
    value: String(s.n),
    ...(emoji ? { emoji } : {}),
  };
}

function unitOption(match: Match, u: Unit, names: CivNames, members: Members): APISelectMenuOption {
  if (!isTeamer(match)) return seatOption(u.seats[0]!, names, members);
  const players = u.seats.map((s) => nameIn(s.player, members)).join(', ');
  return { label: `Team ${u.id}`, description: fit(players, 100), value: String(u.id) };
}

// The placement each seat gets from units listed best first, sent only where
// it changes. Units in one group share a place.
function placementEdits(groups: readonly (readonly Unit[])[]): SeatEdit[] {
  return groups.flatMap((group, place) =>
    group.flatMap((u) => u.seats.filter((s) => s.player.placement !== place).map((s) => ({ seat: s.index, placement: place }))),
  );
}

function seatLine(match: Match, s: Numbered, names: CivNames): string {
  const p = s.player;
  const id = idOf(p);
  const who = id ? mention(id) : `\`${saveName(p)}\` ${MARK.unassigned}`;
  const left = s.leaver ? (idOf(s.leaver) ? mention(idOf(s.leaver) ?? '') : `\`${saveName(s.leaver)}\``) : null;
  const facts = [
    ordinal((p.placement ?? 0) + 1),
    isTeamer(match) ? `team ${p.team + 1}` : null,
    p.quit ? `${MARK.quit} quit` : null,
    left ? `${MARK.sub} for ${left}` : null,
  ].filter((x): x is string => x !== null);
  return `\`${s.n}\` ${who} ${iconOf(names, leaderOf(s))} \u2014 ${facts.join(' \u00b7 ')}`;
}

const button = (matchId: string, verb: string, label: string, style: ButtonStyle, ...args: string[]): ButtonBuilder =>
  new ButtonBuilder().setCustomId(customId('report', verb, matchId, ...args)).setLabel(label).setStyle(style);

// The private panel a report is fixed from: one seat at a time from the menu,
// players or places five at a time, and for staff, a tie.
export function editorPanel(match: Match, names: CivNames, members: Members, asStaff: boolean): Panel {
  const seats = numbered(match);
  const id = match.match_id;
  const pick = new StringSelectMenuBuilder()
    .setCustomId(customId('report', EDIT.seat, id))
    .setPlaceholder('Edit one seat: player, quit or sub\u2026')
    .addOptions(seats.map((s) => seatOption(s, names, members)));
  const places = pagesOf(unitsOf(match));
  const players = pagesOf(seats);
  const buttons = [
    ...places.map((page, i) =>
      button(id, EDIT.order, places.length === 1 ? 'Set order' : `Order ${rangeOf(i * PAGE + 1, page.length)}`, ButtonStyle.Primary, String(i)),
    ),
    ...players.map((page, i) =>
      button(id, EDIT.assign, players.length === 1 ? 'Assign players' : `Assign ${rangeOf(i * PAGE + 1, page.length)}`, ButtonStyle.Secondary, String(i)),
    ),
    ...(asStaff ? [button(id, EDIT.tie, 'Set a tie', ButtonStyle.Secondary)] : []),
  ];
  const rows = [new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(pick)];
  for (let i = 0; i < buttons.length; i += 5) {
    rows.push(new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(buttons.slice(i, i + 5)));
  }
  return {
    tone: 'info',
    surface: 'report',
    title: `Edit ${reportLabel(match)} report`,
    subtitle: `Match \`${id}\` \u00b7 editing as ${asStaff ? 'staff' : 'the reporter'}`,
    body: [text(seats.map((s) => seatLine(match, s, names)).join('\n'))],
    actions: rows,
    footer: asStaff ? 'Set order gives a straight order; Set a tie puts players level.' : 'Ties are set by staff.',
  };
}

// The field that holds a seat's player in the assign form.
const seatField = (n: number): string => `seat${n}`;

// Up to five seats, each named by its civ and the name in the save, with the
// player who holds it now already picked.
export function assignForm(match: Match, names: CivNames, page: number): ModalBuilder | null {
  const pages = pagesOf(numbered(match));
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
      .setLabel(fit(`Seat ${s.n} \u00b7 ${plainNameOf(names, leaderOf(s))}`, 45))
      .setDescription(fit(s.player.user_name ? `In the save: ${s.player.user_name}` : 'No player name in the save', 100))
      .setUserSelectMenuComponent(pickPlayer);
  });
  return new ModalBuilder()
    .setCustomId(customId('report', EDIT.assignForm, match.match_id, String(page)))
    .setTitle(pages.length === 1 ? 'Assign players' : `Assign players: seats ${rangeOf(seats[0]!.n, seats.length)}`)
    .addLabelComponents(...labels);
}

// One edit per seat whose player changed. An emptied field leaves the seat
// as it is: a seat is never unassigned.
export function assignEdits(match: Match, page: number, picked: (field: string) => string | null): SeatEdit[] {
  return (pagesOf(numbered(match))[page] ?? []).flatMap((s) => {
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

// The field that holds who finished in a place.
const placeField = (place: number): string => `place${place}`;

// Up to five places, each prefilled with who holds it now; options are seats,
// or teams in a teamer, so unassigned seats can be ordered too.
export function orderForm(match: Match, names: CivNames, members: Members, page: number): ModalBuilder | null {
  const units = unitsOf(match);
  const pages = pagesOf(units);
  const shown = pages[page];
  if (!shown) return null;
  const first = page * PAGE + 1;
  const labels = shown.map((holder, k) => {
    const label = new LabelBuilder()
      .setLabel(`${ordinal((holder.seats[0]?.player.placement ?? 0) + 1)} place`)
      .setStringSelectMenuComponent(
        new StringSelectMenuBuilder()
          .setCustomId(placeField(first + k))
          .setRequired(true)
          .addOptions(units.map((u) => ({ ...unitOption(match, u, names, members), default: u.id === holder.id }))),
      );
    return k === 0 ? label.setDescription('Pick who finished here; whoever held it takes their old place.') : label;
  });
  return new ModalBuilder()
    .setCustomId(customId('report', EDIT.orderForm, match.match_id, String(page)))
    .setTitle(pages.length === 1 ? 'Set the finishing order' : `Finishing order: places ${rangeOf(first, shown.length)}`)
    .addLabelComponents(...labels);
}

export type OrderResult = Readonly<{ ok: true; seats: SeatEdit[] }> | Readonly<{ ok: false; reason: string }>;

// Changed picks only: each moves its seat (or team) in by trading places with
// the holder, so every other place, and any tie, stays as it is.
export function orderEdits(match: Match, page: number, picked: (field: string) => string | null): OrderResult {
  const units = unitsOf(match);
  const list = units.map((u) => u.id);
  const place = new Map(units.map((u) => [u.id, u.seats[0]?.player.placement ?? 0]));
  const first = page * PAGE;
  const moves = list
    .slice(first, first + PAGE)
    .map((held, k) => ({ at: first + k, unit: Number(picked(placeField(first + k + 1)) ?? held) }))
    .filter((m, k) => m.unit !== list[first + k]);
  const twice = moves.find((m, k) => moves.findIndex((o) => o.unit === m.unit) !== k);
  if (twice) return { ok: false, reason: `${isTeamer(match) ? 'Team' : 'Seat'} ${twice.unit} is picked for two places.` };
  for (const { at, unit } of moves) {
    const from = list.indexOf(unit);
    const holder = list[at]!;
    if (from < 0) continue;
    [list[at], list[from]] = [unit, holder];
    const held = place.get(holder)!;
    place.set(holder, place.get(unit)!);
    place.set(unit, held);
  }
  return {
    ok: true,
    seats: units.flatMap((u) =>
      u.seats.filter((s) => s.player.placement !== place.get(u.id)).map((s) => ({ seat: s.index, placement: place.get(u.id)! })),
    ),
  };
}

// Staff put two or more seats (or teams) level at one place; a tie of two
// leaves one place fewer, so the last place is not offered.
export function tieForm(match: Match, names: CivNames, members: Members): ModalBuilder {
  const units = unitsOf(match);
  const word = isTeamer(match) ? 'teams' : 'players';
  return new ModalBuilder()
    .setCustomId(customId('report', EDIT.tieForm, match.match_id))
    .setTitle('Set a tie')
    .addLabelComponents(
      new LabelBuilder().setLabel('Place').setStringSelectMenuComponent(
        new StringSelectMenuBuilder()
          .setCustomId(FIELD.place)
          .setRequired(true)
          .addOptions(units.slice(1).map((_, i) => ({ label: ordinal(i + 1), value: String(i + 1) }))),
      ),
      new LabelBuilder()
        .setLabel(`Tied ${word}`)
        .setDescription('Everyone else keeps their order around them.')
        .setStringSelectMenuComponent(
          new StringSelectMenuBuilder()
            .setCustomId(FIELD.tied)
            .setMinValues(2)
            .setMaxValues(units.length)
            .setRequired(true)
            .addOptions(units.map((u) => unitOption(match, u, names, members))),
        ),
    );
}

// The tied units become one group at the place; the rest keep their groups.
export function tieEdits(match: Match, place: number, tied: readonly number[]): SeatEdit[] {
  const units = unitsOf(match);
  const level = units.filter((u) => tied.includes(u.id));
  const groups: Unit[][] = [];
  for (const u of units.filter((x) => !tied.includes(x.id))) {
    const last = groups.at(-1);
    if (last && last[0]!.seats[0]!.player.placement === u.seats[0]!.player.placement) last.push(u);
    else groups.push([u]);
  }
  groups.splice(Math.min(place - 1, groups.length), 0, level);
  return placementEdits(groups);
}
