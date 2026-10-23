import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  CheckboxBuilder,
  LabelBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  type APISelectMenuOption,
  type MessageActionRowComponentBuilder,
} from 'discord.js';

import type { Match, SeatEdit } from '../../api/types.js';
import {
  customId,
  divider,
  fit,
  iconOf,
  mention,
  notice,
  plainNameOf,
  portraitOf,
  row,
  text,
  type Block,
  type CivNames,
  type Panel,
} from '../kit/index.js';
import { MARK, isAssigned, isTeamer, ordinal, reportLabel, seatsOf, unknownCiv } from './report.js';

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
  quits: 'quits',
  quitsForm: 'quitsform',
  civs: 'civs',
  civsForm: 'civsform',
  done: 'done',
} as const;
export const FIELD = {
  player: 'player',
  finished: 'finished',
  quit: 'quit',
  left: 'left',
  place: 'place',
  tied: 'tied',
  quits: 'quits',
} as const;

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
const isCiv7 = (match: Match): boolean => match.game.toLowerCase() === 'civ7';
const saveName = (p: Seat['player']): string => p.user_name ?? 'unknown';
const pagesOf = <T>(items: readonly T[]): T[][] =>
  Array.from({ length: Math.ceil(items.length / PAGE) }, (_, i) => items.slice(i * PAGE, i * PAGE + PAGE));
const rangeOf = (first: number, count: number): string => (count === 1 ? String(first) : `${first}\u2013${first + count - 1}`);

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

const unitIdOf = (match: Match, s: Numbered): number => (isTeamer(match) ? s.player.team + 1 : s.n);

// Each unit's place, as edits move units around.
type Places = Map<number, number>;
const placesOf = (units: readonly Unit[]): Places => new Map(units.map((u) => [u.id, u.seats[0]?.player.placement ?? 0]));

// Two units trade places and nobody else moves, so ties elsewhere stand.
function trade(places: Places, a: number, b: number): void {
  const held = places.get(a)!;
  places.set(a, places.get(b)!);
  places.set(b, held);
}

// One edit per seat whose placement differs from where its unit now stands.
function placeEdits(units: readonly Unit[], places: Places): SeatEdit[] {
  return units.flatMap((u) =>
    u.seats.filter((s) => s.player.placement !== places.get(u.id)).map((s) => ({ seat: s.index, placement: places.get(u.id)! })),
  );
}

// Edits for one seat, gathered into one, as core-api takes a seat once.
function merged(edits: readonly SeatEdit[]): SeatEdit[] {
  const bySeat = new Map<number, SeatEdit>();
  for (const e of edits) bySeat.set(e.seat, { ...bySeat.get(e.seat), ...e });
  return [...bySeat.values()];
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

const unitName = (match: Match, u: Unit, members: Members): string =>
  isTeamer(match) ? `Team ${u.id}` : nameIn(u.seats[0]!.player, members);

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

const rowsOf = (buttons: readonly ButtonBuilder[]): Block[] =>
  pagesOf(buttons).map((five) => row(new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(five)));

// The private panel a report is fixed from: one seat at a time from the menu,
// places, players and quits in bulk, and below, what only staff may do.
export function editorPanel(match: Match, names: CivNames, members: Members, asStaff: boolean): Panel {
  const seats = numbered(match);
  const id = match.match_id;
  const pick = new StringSelectMenuBuilder()
    .setCustomId(customId('report', EDIT.seat, id))
    .setPlaceholder('Edit one seat: player, place, quit or sub\u2026')
    .addOptions(seats.map((s) => seatOption(s, names, members)));
  const places = pagesOf(unitsOf(match));
  const players = pagesOf(seats);
  const main = [
    ...places.map((page, i) =>
      button(id, EDIT.order, places.length === 1 ? 'Set order' : `Order ${rangeOf(i * PAGE + 1, page.length)}`, ButtonStyle.Primary, String(i)),
    ),
    ...players.map((page, i) =>
      button(id, EDIT.assign, players.length === 1 ? 'Assign players' : `Assign ${rangeOf(i * PAGE + 1, page.length)}`, ButtonStyle.Secondary, String(i)),
    ),
    button(id, EDIT.quits, 'Quits', ButtonStyle.Secondary),
  ];
  const body: Block[] = [
    text(seats.map((s) => seatLine(match, s, names)).join('\n')),
    row(new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(pick)),
    divider(),
    text('**Bulk edits**'),
    ...rowsOf(main),
  ];
  if (asStaff) {
    const staff = [
      ...(unitsOf(match).length > 1 ? [button(id, EDIT.tie, 'Set a tie', ButtonStyle.Secondary)] : []),
      ...players.map((page, i) =>
        button(id, EDIT.civs, players.length === 1 ? 'Set civs' : `Civs ${rangeOf(i * PAGE + 1, page.length)}`, ButtonStyle.Secondary, String(i)),
      ),
    ];
    body.push(divider(), text('**Staff actions**'), ...rowsOf(staff));
  }
  body.push(divider(), ...rowsOf([button(id, EDIT.done, 'Done', ButtonStyle.Success)]));
  return {
    tone: 'info',
    surface: 'report',
    title: `Edit ${reportLabel(match)} report`,
    subtitle: `Match \`${id}\` \u00b7 editing as ${asStaff ? 'staff' : 'the reporter'}`,
    body,
  };
}

// What an editor becomes when it closes, idle or replaced by a newer one.
export const EDITOR_CLOSED = 'This editor has closed. Press Edit on the report to open it again.';
export const closedEditor = (): Panel => notice('muted', EDITOR_CLOSED);

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
  const seats = numbered(match);
  return (pagesOf(seats)[page] ?? []).flatMap((s) => {
    const id = picked(seatField(s.n));
    if (!id || id === idOf(s.player)) return [];
    // A player moved here from another seat brings their quit mark.
    const from = seats.find((o) => idOf(o.player) === id);
    return [{ seat: s.index, discord_id: id, ...(from && from.player.quit !== s.player.quit ? { quit: from.player.quit } : {}) }];
  });
}

// One seat's whole state in one form: who played it, where it finished,
// whether they quit, and who they replaced if they came in as a sub.
export function seatForm(match: Match, n: number, members: Members): ModalBuilder | null {
  const seat = numbered(match).find((s) => s.n === n);
  if (!seat) return null;
  const units = unitsOf(match);
  const places = placesOf(units);
  const mine = places.get(unitIdOf(match, seat));
  const finished = new StringSelectMenuBuilder()
    .setCustomId(FIELD.finished)
    .setRequired(true)
    .addOptions(
      [...new Set(places.values())].map((place) => ({
        label: ordinal(place + 1),
        description: fit(`Now: ${units.filter((u) => places.get(u.id) === place).map((u) => unitName(match, u, members)).join(', ')}`, 100),
        value: String(place),
        default: place === mine,
      })),
    );
  const player = new UserSelectMenuBuilder().setCustomId(FIELD.player).setMinValues(1).setMaxValues(1).setRequired(true);
  const playerId = idOf(seat.player);
  if (playerId) player.setDefaultUsers(playerId);
  const left = new UserSelectMenuBuilder().setCustomId(FIELD.left).setMinValues(0).setMaxValues(1).setRequired(false);
  const leftId = idOf(seat.leaver);
  if (leftId) left.setDefaultUsers(leftId);
  return new ModalBuilder()
    .setCustomId(customId('report', EDIT.seatForm, match.match_id, String(n), String(mine ?? 0)))
    .setTitle(fit(`Seat ${seat.n}: ${nameIn(seat.player, members)}`, 45))
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('Player')
        .setDescription('Who played this seat to the end.')
        .setUserSelectMenuComponent(player),
      new LabelBuilder()
        .setLabel('Finished')
        .setDescription(isTeamer(match) ? 'Moves the whole team; the team there takes its place.' : 'Whoever finished there takes this seat\'s place.')
        .setStringSelectMenuComponent(finished),
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

// `shown` is the place the form opened with: only a change from it moves the
// seat, so a form open while others edit does not undo their moves.
export type SeatChoice = Readonly<{ player: string | null; place: number; shown: number; quit: boolean; left: string | null }>;

// Only what changed is sent; an empty "came in for" leaves an unregistered
// leaver as it is. A player or a place taken from another seat is swapped.
export function seatEdits(match: Match, n: number, chosen: SeatChoice): SeatEdit[] {
  const seats = numbered(match);
  const seat = seats.find((s) => s.n === n);
  if (!seat) return [];
  const edit: SeatEdit = { seat: seat.index };
  const swap: SeatEdit[] = [];
  const current = idOf(seat.player);
  let quit = chosen.quit;
  if (chosen.player && chosen.player !== current) {
    edit.discord_id = chosen.player;
    const other = seats.find((s) => s !== seat && idOf(s.player) === chosen.player);
    if (other && current) {
      // Players trade seats with their own quit marks, unless one was ticked.
      swap.push({ seat: other.index, discord_id: current, ...(other.player.quit !== seat.player.quit ? { quit: seat.player.quit } : {}) });
      if (chosen.quit === seat.player.quit) quit = other.player.quit;
    }
  }
  if (quit !== seat.player.quit) edit.quit = quit;
  const before = idOf(seat.leaver);
  if (chosen.left && chosen.left !== before) edit.sub_out = chosen.left;
  else if (!chosen.left && before) edit.sub_out = null;
  const units = unitsOf(match);
  const places = placesOf(units);
  const mine = unitIdOf(match, seat);
  const holder = units.find((u) => u.id !== mine && places.get(u.id) === chosen.place);
  if (holder && chosen.place !== chosen.shown) trade(places, mine, holder.id);
  return merged([...(Object.keys(edit).length > 1 ? [edit] : []), ...swap, ...placeEdits(units, places)]);
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

export type EditResult = Readonly<{ ok: true; seats: SeatEdit[] }> | Readonly<{ ok: false; reason: string }>;

// Changed picks only: each moves its seat (or team) in by trading places with
// the holder, so every other place, and any tie, stays as it is.
export function orderEdits(match: Match, page: number, picked: (field: string) => string | null): EditResult {
  const units = unitsOf(match);
  const list = units.map((u) => u.id);
  const places = placesOf(units);
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
    trade(places, unit, holder);
  }
  return { ok: true, seats: placeEdits(units, places) };
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
  return placeEdits(units, new Map(groups.flatMap((group, at) => group.map((u): [number, number] => [u.id, at]))));
}

// Everyone with a player, with who quit already ticked. A seat needs its
// player before it can be marked.
export function quitsForm(match: Match, names: CivNames, members: Members): ModalBuilder | null {
  const seats = numbered(match).filter((s) => idOf(s.player));
  if (!seats.length) return null;
  return new ModalBuilder()
    .setCustomId(customId('report', EDIT.quitsForm, match.match_id))
    .setTitle('Who quit?')
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('Players who quit')
        .setDescription('Pick everyone who quit; clear anyone who did not.')
        .setStringSelectMenuComponent(
          new StringSelectMenuBuilder()
            .setCustomId(FIELD.quits)
            .setMinValues(0)
            .setMaxValues(seats.length)
            .setRequired(false)
            .addOptions(seats.map((s) => ({ ...seatOption(s, names, members), default: s.player.quit }))),
        ),
    );
}

export function quitEdits(match: Match, picked: readonly string[]): SeatEdit[] {
  return numbered(match)
    .filter((s) => idOf(s.player))
    .flatMap((s) => {
      const quit = picked.includes(String(s.n));
      return quit === s.player.quit ? [] : [{ seat: s.index, quit }];
    });
}

// The field that holds a seat's leader, typed by staff.
const civField = (n: number): string => `civ${n}`;

// A seat's leader (civ7: and civ) as the civs form writes it, or blank where
// the civ data does not know it.
const civEntry = (match: Match, names: CivNames, s: Seat): string => {
  if (unknownCiv(match, names, s.player)) return '';
  const leader = plainNameOf(names, leaderOf(s));
  return isCiv7(match) && s.player.leader ? `${leader} / ${plainNameOf(names, s.player.civ)}` : leader;
};

// Staff set the leader (civ7: and civ) of any seat, five at a time. Known ones
// are filled in; an unknown one is blank, with the token the save holds.
export function civsForm(match: Match, names: CivNames, members: Members, page: number): ModalBuilder | null {
  const pages = pagesOf(numbered(match));
  const seats = pages[page];
  if (!seats) return null;
  const civ7 = isCiv7(match);
  return new ModalBuilder()
    .setCustomId(customId('report', EDIT.civsForm, match.match_id, String(page)))
    .setTitle(pages.length === 1 ? 'Set civs' : `Set civs: seats ${rangeOf(seats[0]!.n, seats.length)}`)
    .addLabelComponents(
      ...seats.map((s) => {
        const unknown = unknownCiv(match, names, s.player);
        const input = new TextInputBuilder()
          .setCustomId(civField(s.n))
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(80)
          .setPlaceholder(civ7 ? 'Leader / civ, as in Amina / Aksum' : 'Leader, as in Sejong');
        const entry = civEntry(match, names, s);
        if (entry) input.setValue(entry);
        return new LabelBuilder()
          .setLabel(fit(`Seat ${s.n} \u00b7 ${nameIn(s.player, members)}`, 45))
          .setDescription(fit(unknown ? `Not in the civ data: ${unknown}` : 'Type another name to change it.', 100))
          .setTextInputComponent(input);
      }),
    );
}

// A typed name to its token: an exact name first, else the one name holding it.
function tokenOf(names: CivNames, prefix: string, typed: string): Readonly<{ token: string }> | Readonly<{ reason: string }> {
  const want = typed.trim().toLowerCase();
  const tokens = [...names.keys()].filter((t) => t.startsWith(prefix));
  const shown = (t: string): string => plainNameOf(names, t).toLowerCase();
  const exact = tokens.filter((t) => shown(t) === want || t.toLowerCase() === want);
  const hits = exact.length ? exact : tokens.filter((t) => want && shown(t).includes(want));
  if (hits.length === 1) return { token: hits[0]! };
  const kind = prefix === 'LEADER_' ? 'leader' : 'civ';
  if (!hits.length) return { reason: `no ${kind} is called "${typed.trim()}".` };
  const options = hits.slice(0, 5).map((t) => `${plainNameOf(names, t)} (${t})`);
  return { reason: `"${typed.trim()}" could be ${options.join(', ')}. Type the one in brackets.` };
}

// Every seat whose name was changed; a blank one, or a seat not on the form,
// is left as it is.
export function civEdits(match: Match, names: CivNames, typed: (field: string) => string): EditResult {
  const civ7 = isCiv7(match);
  const seats: SeatEdit[] = [];
  for (const s of numbered(match)) {
    const entry = typed(civField(s.n)).trim();
    if (!entry || entry === civEntry(match, names, s)) continue;
    const [leaderText = '', civText] = civ7 ? entry.split('/') : [entry];
    if (civ7 && civText === undefined) return { ok: false, reason: `Seat ${s.n}: write the leader and the civ, as in Amina / Aksum.` };
    const leader = tokenOf(names, 'LEADER_', leaderText);
    if ('reason' in leader) return { ok: false, reason: `Seat ${s.n}: ${leader.reason}` };
    const edit: SeatEdit = { seat: s.index, leader: leader.token };
    if (civ7) {
      const civ = tokenOf(names, 'CIVILIZATION_', civText ?? '');
      if ('reason' in civ) return { ok: false, reason: `Seat ${s.n}: ${civ.reason}` };
      edit.civ = civ.token;
    }
    seats.push(edit);
  }
  return { ok: true, seats };
}
