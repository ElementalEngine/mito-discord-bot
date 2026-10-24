import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  LabelBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  UserSelectMenuBuilder,
  type APISelectMenuOption,
  type MessageActionRowComponentBuilder,
} from 'discord.js';

import type { Match, SeatEdit } from '../../api/types.js';
import {
  customId,
  divider,
  fit,
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
import { MARK, civOf, isAssigned, isTeamer, ordinal, reportLabel, seatsOf, unknownCiv } from './report.js';

// The editor's verbs and the form fields they read.
export const EDIT = {
  seat: 'seat',
  seatForm: 'seatform',
  assign: 'assign',
  assignPick: 'assignpick',
  order: 'order',
  orderPick: 'orderpick',
  save: 'save',
  tie: 'tie',
  tieForm: 'tieform',
  quits: 'quits',
  quitsForm: 'quitsform',
  civs: 'civs',
  civSeat: 'civseat',
  civPick: 'civpick',
  back: 'back',
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

// The seat form's quit menu: the seat's player, and the player a sub replaced.
export const QUIT = { player: 'player', left: 'left' } as const;

// A row holds five buttons.
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
    typeof p.score === 'number' ? `score ${p.score}` : null,
    p.quit ? `${MARK.quit} quit` : null,
    left ? `${MARK.sub} for ${left}${s.leaver?.quit ? ` (${MARK.quit} quit)` : ''}` : null,
  ].filter((x): x is string => x !== null);
  return `\`${s.n}\` ${who} ${civOf(match, p, names)} \u2014 ${facts.join(' \u00b7 ')}`;
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
  const main = [
    button(id, EDIT.order, 'Set order', ButtonStyle.Primary),
    button(id, EDIT.assign, 'Assign players', ButtonStyle.Secondary),
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
      button(id, EDIT.civs, 'Set civs', ButtonStyle.Secondary),
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
export const EDITOR_CLOSED = 'This editor has closed. If the report is still waiting, press Edit on it to open it again.';
export const closedEditor = (): Panel => notice('muted', EDITOR_CLOSED);

// The order, assign and civ panels stand in for the editor and change only a
// draft of the match; Save sends the whole draft as one edit.
export type DraftKind = 'order' | 'assign' | 'civs';
// `rev` goes into each menu's id, so Discord redraws every menu from the
// draft rather than keeping a pick it was shown; `focus` is the civ seat.
export type Draft = Readonly<{ kind: DraftKind; base: Match; now: Match; rev: number; focus: number }>;

const MENUS_MAX = 15;
const pastMenus = (count: number): Block[] =>
  count > MENUS_MAX ? [text(`Seats past ${MENUS_MAX} are set from **Edit one seat**.`)] : [];

// What Save sends: each seat whose player, place, quit mark, leader or civ the
// draft changed.
export function draftEdits(base: Match, draft: Match): SeatEdit[] {
  return seatsOf(base).flatMap(({ index, player: was }) => {
    const now = draft.players[index];
    if (!now) return [];
    const edit: SeatEdit = { seat: index };
    if (now.placement !== was.placement && typeof now.placement === 'number') edit.placement = now.placement;
    if (now.discord_id !== was.discord_id && now.discord_id) edit.discord_id = now.discord_id;
    if (now.quit !== was.quit) edit.quit = now.quit;
    if (now.leader !== was.leader && now.leader) edit.leader = now.leader;
    if (now.civ !== was.civ) edit.civ = now.civ;
    return Object.keys(edit).length > 1 ? [edit] : [];
  });
}

// The unsaved changes, seat by seat, so nothing waits on Save unseen.
function pendingLine(draft: Draft, names: CivNames): string | null {
  const changes = numbered(draft.base).flatMap((s) => {
    const was = s.player;
    const now = draft.now.players[s.index];
    if (!now) return [];
    const what = [
      now.discord_id !== was.discord_id ? (idOf(now) ? mention(idOf(now) ?? '') : 'unassigned') : null,
      now.placement !== was.placement ? ordinal((now.placement ?? 0) + 1) : null,
      now.leader !== was.leader && now.leader ? plainNameOf(names, now.leader) : null,
      now.civ !== was.civ && isCiv7(draft.now) ? plainNameOf(names, now.civ) : null,
      now.quit !== was.quit ? (now.quit ? 'quit' : 'did not quit') : null,
    ].filter((x): x is string => x !== null);
    return what.length ? [`Seat ${s.n} \u2192 ${what.join(', ')}`] : [];
  });
  return changes.length ? `**Not saved yet:** ${changes.join(' \u00b7 ')}` : null;
}

function draftFrame(draft: Draft, names: CivNames, title: string, body: readonly Block[]): Panel {
  const id = draft.now.match_id;
  const changed = draftEdits(draft.base, draft.now).length;
  const save = button(id, EDIT.save, changed ? `Save ${changed} change${changed === 1 ? '' : 's'}` : 'Nothing to save', ButtonStyle.Success)
    .setDisabled(!changed);
  const pending = pendingLine(draft, names);
  return {
    tone: 'info',
    surface: 'report',
    title: `${title}: ${reportLabel(draft.now)} report`,
    subtitle: `Match \`${id}\` \u00b7 nothing is saved until you press Save`,
    body: [...body, ...(pending ? [text(pending)] : []), divider(), ...rowsOf([save, button(id, EDIT.back, 'Back to the editor', ButtonStyle.Secondary)])],
  };
}

export function draftPanel(draft: Draft, names: CivNames, members: Members): Panel {
  if (draft.kind === 'order') return orderPanel(draft, names, members);
  if (draft.kind === 'assign') return assignPanel(draft, names, members);
  return civsPanel(draft, names, members);
}

// Every place in one panel, best first, each menu labelled with its place.
function orderPanel(draft: Draft, names: CivNames, members: Members): Panel {
  const match = draft.now;
  const units = unitsOf(match);
  const menus = units.slice(0, MENUS_MAX).map((holder) => {
    const at = holder.seats[0]?.player.placement ?? 0;
    const place = ordinal(at + 1);
    const menu = new StringSelectMenuBuilder()
      .setCustomId(customId('report', EDIT.orderPick, match.match_id, String(at), String(holder.id), String(draft.rev)))
      .addOptions(
        units.map((u) => {
          const option = unitOption(match, u, names, members);
          return { ...option, label: fit(`${place} \u00b7 ${option.label}`, 100), default: u.id === holder.id };
        }),
      );
    return row(new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(menu));
  });
  const hint = 'Pick who finished in each place. The one you pick swaps places with whoever was there.';
  return draftFrame(draft, names, 'Set order', [text(hint), ...menus, ...pastMenus(units.length)]);
}

// The draft with `unit` moved into place `at`, trading with the one there: the
// menu's own holder while it still holds the place, else whoever does now.
export function withOrderPick(match: Match, at: number, holder: number, unit: number): Match {
  const units = unitsOf(match);
  const places = placesOf(units);
  if (!places.has(unit) || places.get(unit) === at) return match;
  const there = places.get(holder) === at ? holder : units.find((u) => places.get(u.id) === at)?.id;
  if (there === undefined) return match;
  trade(places, unit, there);
  const players = [...match.players];
  for (const u of units) {
    for (const s of u.seats) players[s.index] = { ...s.player, placement: places.get(u.id) ?? s.player.placement };
  }
  return { ...match, players };
}

// One menu per seat, labelled with the seat and who has it now. Discord's
// member menu searches the whole server as a name is typed.
function assignPanel(draft: Draft, names: CivNames, members: Members): Panel {
  const match = draft.now;
  const seats = numbered(match);
  const menus = seats.slice(0, MENUS_MAX).map((s) => {
    const id = idOf(s.player);
    const save = s.player.user_name ? ` (save: ${s.player.user_name})` : '';
    const name = id ? members.get(id) : undefined;
    const now = id ? (name ? `now ${name}` : 'assigned') : `unassigned${save}`;
    const menu = new UserSelectMenuBuilder()
      .setCustomId(customId('report', EDIT.assignPick, match.match_id, String(s.n), String(draft.rev)))
      .setPlaceholder(fit(`Seat ${s.n} \u00b7 ${plainNameOf(names, leaderOf(s))} \u00b7 ${now}`, 150));
    return row(new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(menu));
  });
  const hint = 'Pick the player for each seat; type a name to search the server. Picking someone who has another seat swaps the two.';
  return draftFrame(draft, names, 'Assign players', [text(hint), ...menus, ...pastMenus(seats.length)]);
}

// The draft with `id` in seat n: someone with another seat swaps with this
// seat's player, or moves here if this seat is empty and theirs was empty in the save.
export function withAssignPick(base: Match, match: Match, n: number, id: string): Match | string {
  const seats = numbered(match);
  const seat = seats.find((s) => s.n === n);
  const current = seat ? idOf(seat.player) : null;
  if (!seat || !id || id === current) return match;
  const players = [...match.players];
  const other = seats.find((s) => s !== seat && idOf(s.player) === id);
  if (other) {
    const before = base.players[other.index];
    if (current) players[other.index] = { ...other.player, discord_id: current, quit: seat.player.quit };
    else if (before && !idOf(before)) players[other.index] = { ...other.player, discord_id: before.discord_id, quit: before.quit };
    else return `${mention(id)} has seat ${other.n}. Give seat ${other.n} another player first.`;
  }
  players[seat.index] = { ...seat.player, discord_id: id, quit: other ? other.player.quit : seat.player.quit };
  return { ...match, players };
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
  const quitter = new StringSelectMenuBuilder()
    .setCustomId(FIELD.quit)
    .setMinValues(0)
    .setMaxValues(2)
    .setRequired(false)
    .setPlaceholder('Nobody quit')
    // A form cannot redraw itself, so the options name the boxes, not people.
    .addOptions(
      {
        label: 'Player in seat quit',
        description: 'The player in the first box left early',
        value: QUIT.player,
        default: seat.player.quit,
      },
      {
        label: 'Player subbed out quit',
        description: 'The player in the subbed out box left early',
        value: QUIT.left,
        default: seat.leaver?.quit ?? false,
      },
    );
  return new ModalBuilder()
    .setCustomId(customId('report', EDIT.seatForm, match.match_id, String(n), String(mine ?? 0)))
    .setTitle(fit(`Seat ${seat.n}: ${nameIn(seat.player, members)}`, 45))
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('Player')
        .setDescription('Who was in this seat at the end of the game.')
        .setUserSelectMenuComponent(player),
      new LabelBuilder()
        .setLabel('Place')
        .setDescription(isTeamer(match) ? 'Where the team finished. Whoever has that place swaps with them.' : 'Where they finished. Whoever has that place swaps with them.')
        .setStringSelectMenuComponent(finished),
      new LabelBuilder()
        .setLabel('Player subbed out (optional)')
        .setDescription('Only if someone left and the player above took their seat.')
        .setUserSelectMenuComponent(left),
      new LabelBuilder()
        .setLabel('Did they quit? (optional)')
        .setDescription('Pick everyone who quit. You can pick both.')
        .setStringSelectMenuComponent(quitter),
    );
}

// `shown` is the place the form opened with: only a change from it moves the
// seat, so a form open while others edit does not undo their moves. `quit` is
// the seat player's; `leftQuit`, when given, is the quit of the player who left.
export type SeatChoice = Readonly<{
  player: string | null;
  place: number;
  shown: number;
  quit: boolean;
  left: string | null;
  leftQuit?: boolean;
}>;

// Only what changed is sent; an empty "came in for" leaves an unregistered
// leaver as it is. A player or place taken from another seat is swapped.
export function seatEdits(match: Match, n: number, chosen: SeatChoice): SeatEdit[] | string {
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
    // An empty seat has no player to give back, and a seat is never emptied.
    if (other && !current) return `${mention(chosen.player)} has seat ${other.n}. Give seat ${other.n} another player first.`;
    if (other && current) {
      // Players trade seats with their own quit marks, unless one was ticked.
      swap.push({ seat: other.index, discord_id: current, ...(other.player.quit !== seat.player.quit ? { quit: seat.player.quit } : {}) });
      if (chosen.quit === seat.player.quit) quit = other.player.quit;
    }
  }
  if (quit !== seat.player.quit) edit.quit = quit;
  const before = idOf(seat.leaver);
  const replaced = Boolean(chosen.left && chosen.left !== before);
  const cleared = !chosen.left && Boolean(before);
  if (replaced) edit.sub_out = chosen.left;
  else if (cleared) edit.sub_out = null;
  // The box opens as the current leaver's mark, so only a change is sent. A
  // sub repointed to someone new starts them unmarked unless the box changed.
  if (chosen.leftQuit !== undefined && !cleared && chosen.leftQuit !== (seat.leaver?.quit ?? false)) {
    const paired = seat.player.is_sub && seat.leaver;
    if (chosen.leftQuit && !replaced && !paired) return 'Pick the player subbed out first, then mark that they quit.';
    if (chosen.leftQuit && !replaced && !before) return 'The player subbed out is not registered. Pick them in the Player subbed out box first.';
    edit.leaver_quit = chosen.leftQuit;
  }
  const units = unitsOf(match);
  const places = placesOf(units);
  const mine = unitIdOf(match, seat);
  const holder = units.find((u) => u.id !== mine && places.get(u.id) === chosen.place);
  if (holder && chosen.place !== chosen.shown) trade(places, mine, holder.id);
  return merged([...(Object.keys(edit).length > 1 ? [edit] : []), ...swap, ...placeEdits(units, places)]);
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

const leftValue = (s: Numbered): string => `${s.n}-left`;
const QUITS_MAX = 25;

// The player a sub came in for, where core-api can mark them: paired to a sub
// seat and registered.
const markableLeaver = (s: Seat): Seat['player'] | null =>
  s.player.is_sub && s.leaver && idOf(s.leaver) ? s.leaver : null;

// Everyone the quits form offers, in seat order: each seat's player, then the
// player its sub came in for. A menu holds 25; past that, Edit one seat.
function quitChoices(match: Match, names: CivNames, members: Members): APISelectMenuOption[] {
  return numbered(match)
    .flatMap((s) => {
      const own = idOf(s.player) ? [{ ...seatOption(s, names, members), default: s.player.quit }] : [];
      const leaver = markableLeaver(s);
      const left = leaver
        ? [{
            label: fit(`${s.n}. ${nameIn(leaver, members)} (subbed out)`, 100),
            description: fit(`Replaced by ${nameIn(s.player, members)}`, 100),
            value: leftValue(s),
            default: leaver.quit,
          }]
        : [];
      return [...own, ...left];
    })
    .slice(0, QUITS_MAX);
}

// Everyone with a player, and everyone a sub came in for, with who quit
// already ticked. A seat needs its player before it can be marked.
export function quitsForm(match: Match, names: CivNames, members: Members): ModalBuilder | null {
  const options = quitChoices(match, names, members);
  if (!options.length) return null;
  const full = numbered(match).reduce((n, s) => n + (idOf(s.player) ? 1 : 0) + (markableLeaver(s) ? 1 : 0), 0) > QUITS_MAX;
  return new ModalBuilder()
    .setCustomId(customId('report', EDIT.quitsForm, match.match_id))
    .setTitle('Who quit?')
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('Players who quit')
        .setDescription(
          full
            ? 'Pick everyone who quit. Anyone not listed is set from Edit one seat.'
            : 'Pick everyone who quit. Untick anyone who did not.',
        )
        .setStringSelectMenuComponent(
          new StringSelectMenuBuilder()
            .setCustomId(FIELD.quits)
            .setMinValues(0)
            .setMaxValues(options.length)
            .setRequired(false)
            .addOptions(options),
        ),
    );
}

// One edit per seat: its player's quit and its leaver's, as they changed.
// Only what the form offered is read, so anyone past the list keeps their mark.
export function quitEdits(match: Match, picked: readonly string[]): SeatEdit[] {
  const offered = new Set(quitChoices(match, new Map(), new Map()).map((o) => o.value));
  return numbered(match).flatMap((s) => {
    const edit: SeatEdit = { seat: s.index };
    const quit = picked.includes(String(s.n));
    if (offered.has(String(s.n)) && quit !== s.player.quit) edit.quit = quit;
    const leaver = markableLeaver(s);
    const leftQuit = picked.includes(leftValue(s));
    if (leaver && offered.has(leftValue(s)) && leftQuit !== leaver.quit) edit.leaver_quit = leftQuit;
    return Object.keys(edit).length > 1 ? [edit] : [];
  });
}

// A menu holds 25 options, so a longer list is split A-Z across even menus.
const MENU = 25;
function menusOf<T>(items: readonly T[]): T[][] {
  const size = Math.ceil(items.length / Math.ceil(items.length / MENU));
  return Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, i * size + size));
}

const initialOf = (names: CivNames, token: string): string => plainNameOf(names, token).charAt(0).toUpperCase();

// Every leader (or civ) the civ data knows, as menus, the seat's own one picked.
function choiceRows(matchId: string, names: CivNames, seat: Numbered, kind: 'leader' | 'civ', rev: number): Block[] {
  const prefix = kind === 'leader' ? 'LEADER_' : 'CIVILIZATION_';
  const current = kind === 'leader' ? leaderOf(seat) : seat.player.civ;
  const tokens = [...names.keys()]
    .filter((t) => t.startsWith(prefix))
    .sort((a, b) => plainNameOf(names, a).localeCompare(plainNameOf(names, b)));
  return menusOf(tokens).map((part, k) => {
    const [from, to] = [initialOf(names, part[0]!), initialOf(names, part.at(-1)!)];
    const menu = new StringSelectMenuBuilder()
      .setCustomId(customId('report', EDIT.civPick, matchId, String(seat.n), `${kind}${k}`, String(rev)))
      .setPlaceholder(`${kind === 'leader' ? 'Leaders' : 'Civs'} ${from === to ? from : `${from}\u2013${to}`}`)
      .addOptions(
        part.map((t) => {
          const emoji = portraitOf(names, t);
          return { label: fit(plainNameOf(names, t), 100), value: t, default: t === current, ...(emoji ? { emoji } : {}) };
        }),
      );
    return row(new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(menu));
  });
}

// Staff pick a seat, then its leader (civ7: and civ) from the civ data's own
// list, so nothing is typed.
function civsPanel(draft: Draft, names: CivNames, members: Members): Panel {
  const match = draft.now;
  const seats = numbered(match);
  const seat = seats.find((s) => s.n === draft.focus) ?? seats[0]!;
  const id = match.match_id;
  const pickSeat = new StringSelectMenuBuilder()
    .setCustomId(customId('report', EDIT.civSeat, id, String(draft.rev)))
    .addOptions(seats.map((s) => ({ ...seatOption(s, names, members), default: s.n === seat.n })));
  const unknown = unknownCiv(match, names, seat.player);
  const leaders = choiceRows(id, names, seat, 'leader', draft.rev);
  const civs = isCiv7(match) ? choiceRows(id, names, seat, 'civ', draft.rev) : [];
  const menus = [...(leaders.length ? [text('**Leader**'), ...leaders] : []), ...(civs.length ? [text('**Civ**'), ...civs] : [])];
  return draftFrame(draft, names, 'Set civs', [
    text(seats.map((s) => seatLine(match, s, names)).join('\n')),
    divider(),
    text(`**Seat ${seat.n}** \u00b7 ${unknown ? `${MARK.civ} not in the civ data: \`${unknown}\`` : 'pick another to change it'}`),
    row(new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(pickSeat)),
    ...(menus.length ? menus : [text('The civ data is unavailable right now. Try again in a moment.')]),
  ]);
}

// The seat the picker shows: the one asked for while its civ is still unknown,
// else the next unknown one, else the one asked for.
export function civFocus(match: Match, names: CivNames, asked = 0): number {
  const seats = numbered(match);
  const unknown = seats.filter((s) => unknownCiv(match, names, s.player));
  if (unknown.some((s) => s.n === asked)) return asked;
  return (unknown.find((s) => s.n > asked) ?? unknown[0] ?? seats.find((s) => s.n === asked) ?? seats[0])?.n ?? 1;
}

// The draft with a picked leader as the seat's leader, or a picked civ as its civ.
export function withCivPick(match: Match, n: number, token: string): Match {
  const seat = numbered(match).find((s) => s.n === n);
  if (!seat || !token) return match;
  const field = token.startsWith('CIVILIZATION_') ? 'civ' : 'leader';
  if (seat.player[field] === token) return match;
  const players = [...match.players];
  players[seat.index] = { ...seat.player, [field]: token };
  return { ...match, players };
}
