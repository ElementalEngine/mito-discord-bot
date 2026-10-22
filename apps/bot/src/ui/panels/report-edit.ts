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
import { isAssigned, isTeamer, ordinal, reportLabel, seatsOf } from './report.js';

// The editor's verbs and the form fields they read.
export const EDIT = { seat: 'seat', seatForm: 'seatform', order: 'order', orderForm: 'orderform' } as const;
export const FIELD = { player: 'player', quit: 'quit', left: 'left', order: 'order' } as const;

type Seat = ReturnType<typeof seatsOf>[number];

// Seats are numbered 1..n in the order the save lists them; core-api calls a
// seat by its index among all rows, which the editor carries alongside.
const numbered = (match: Match): (Seat & { n: number })[] => seatsOf(match).map((s, i) => ({ ...s, n: i + 1 }));

const idOf = (p: Seat['player'] | null): string | null => (p && isAssigned(p) ? (p.discord_id ?? null) : null);

function seatLine(match: Match, s: Seat & { n: number }, names: CivNames): string {
  const p = s.player;
  const facts = [
    plainNameOf(names, p.leader ?? p.civ),
    ordinal((p.placement ?? 0) + 1),
    isTeamer(match) ? `team ${p.team + 1}` : null,
    p.quit ? 'quit' : null,
    s.leaver ? `sub for ${idOf(s.leaver) ? mention(idOf(s.leaver) ?? '') : `\`${s.leaver.user_name ?? 'unknown'}\``}` : null,
  ].filter((x): x is string => x !== null);
  const who = idOf(p) ? mention(idOf(p) ?? '') : `\`${p.user_name ?? 'unknown'}\` \u00b7 unassigned`;
  return `\`${s.n}\` ${who} \u2014 ${facts.join(' \u00b7 ')}`;
}

// The private panel the reporter or staff edits a report from.
export function editorPanel(match: Match, names: CivNames, asStaff: boolean): Panel {
  const seats = numbered(match);
  const pick = new StringSelectMenuBuilder()
    .setCustomId(customId('report', EDIT.seat, match.match_id))
    .setPlaceholder('Edit a seat\u2026')
    .addOptions(
      seats.map((s) => ({
        label: fit(`${s.n}. ${s.player.user_name ?? 'unknown'}`, 100),
        description: fit(plainNameOf(names, s.player.leader ?? s.player.civ), 100),
        value: String(s.index),
      })),
    );
  const order = new ButtonBuilder()
    .setCustomId(customId('report', EDIT.order, match.match_id))
    .setLabel('Set order')
    .setStyle(ButtonStyle.Primary);
  return {
    tone: 'info',
    surface: 'report',
    title: `Edit ${reportLabel(match)} report`,
    subtitle: `Match \`${match.match_id}\` \u00b7 editing as ${asStaff ? 'staff' : 'the reporter'}`,
    body: [text(seats.map((s) => seatLine(match, s, names)).join('\n'))],
    actions: [
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(pick),
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(order),
    ],
    footer: asStaff ? 'Staff may set ties and edit any report.' : 'Ties are set by staff.',
  };
}

// One seat's whole state in one form: who played it, whether they quit, and
// who they replaced if they came in as a sub.
export function seatForm(match: Match, index: number): ModalBuilder | null {
  const seat = numbered(match).find((s) => s.index === index);
  if (!seat) return null;
  const player = new UserSelectMenuBuilder().setCustomId(FIELD.player).setMinValues(1).setMaxValues(1).setRequired(true);
  const playerId = idOf(seat.player);
  if (playerId) player.setDefaultUsers(playerId);
  const left = new UserSelectMenuBuilder().setCustomId(FIELD.left).setMinValues(0).setMaxValues(1).setRequired(false);
  const leftId = idOf(seat.leaver);
  if (leftId) left.setDefaultUsers(leftId);
  return new ModalBuilder()
    .setCustomId(customId('report', EDIT.seatForm, match.match_id, String(index)))
    .setTitle(fit(`Seat ${seat.n}: ${seat.player.user_name ?? 'unknown'}`, 45))
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

// Only what changed is sent. An unregistered leaver has no default to show,
// so an empty answer there leaves the sub as it is.
export function seatEdit(match: Match, index: number, chosen: SeatChoice): SeatEdit | null {
  const seat = numbered(match).find((s) => s.index === index);
  if (!seat) return null;
  const edit: SeatEdit = { seat: index };
  if (chosen.player && chosen.player !== idOf(seat.player)) edit.discord_id = chosen.player;
  if (chosen.quit !== seat.player.quit) edit.quit = chosen.quit;
  const before = idOf(seat.leaver);
  if (chosen.left && chosen.left !== before) edit.sub_out = chosen.left;
  else if (!chosen.left && before) edit.sub_out = null;
  return Object.keys(edit).length > 1 ? edit : null;
}

// What the order is written in: seat numbers, or team numbers for a teamer.
function unitOf(match: Match, s: Seat & { n: number }): number {
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

export function orderForm(match: Match, names: CivNames): ModalBuilder {
  const teamer = isTeamer(match);
  const seats = numbered(match);
  const legend = teamer
    ? [...new Set(seats.map((s) => s.player.team))]
        .sort((a, b) => a - b)
        .map((t) => `**Team ${t + 1}**: ${seats.filter((s) => s.player.team === t).map((s) => s.player.user_name ?? 'unknown').join(', ')}`)
    : seats.map((s) => `\`${s.n}\` ${s.player.user_name ?? 'unknown'} \u2014 ${plainNameOf(names, s.player.leader ?? s.player.civ)}`);
  const input = new TextInputBuilder()
    .setCustomId(FIELD.order)
    .setStyle(TextInputStyle.Short)
    .setValue(orderOf(match))
    .setMaxLength(100)
    .setRequired(true);
  return new ModalBuilder()
    .setCustomId(customId('report', EDIT.orderForm, match.match_id))
    .setTitle('Set the finishing order')
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(fit(legend.join('\n'), 3000)))
    .addLabelComponents(
      new LabelBuilder()
        .setLabel(teamer ? 'Teams, first place first' : 'Seats, first place first')
        .setDescription('Separate with spaces; join a tie with =, as in 3 1=2 4. Ties are for staff.')
        .setTextInputComponent(input),
    );
}
