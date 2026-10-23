import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { Match } from '../../api/types.js';
import { container, type Panel } from '../kit/index.js';
import {
  assignEdits,
  assignForm,
  civEdits,
  civsForm,
  editorPanel,
  orderEdits,
  orderForm,
  quitEdits,
  quitsForm,
  seatEdits,
  seatForm,
  tieEdits,
  tieForm,
} from './report-edit.js';

/**
 * The report editor. What should break this file: an order that skips or
 * repeats a seat reaching core-api, a sub's leaver row counted as a seat, or
 * a seat form that sends fields nobody changed.
 */

const A = '100000000000000001';
const B = '100000000000000002';
const C = '100000000000000003';
const D = '100000000000000004';

type P = Match['players'][number];
const player = (over: Partial<P>): P => ({
  civ: 'LEADER_SHAKA',
  leader: 'LEADER_SHAKA',
  delta: 0,
  discord_id: A,
  is_sub: false,
  subbed_out: false,
  quit: false,
  team: 0,
  placement: 0,
  user_name: 'steam',
  ...over,
});

const match = (players: P[], game_mode = 'FFA'): Match => ({
  match_id: '652f1a2b3c4d5e6f7a8b9c0d',
  game: 'civ6',
  game_mode,
  is_cloud: false,
  turn: 100,
  map_type: 'Pangaea',
  players,
  parser_version: '1',
  discord_messages_id_list: ['m'],
  created_at: '2026-10-22T12:00:00Z',
  flagged: false,
  save_file_hash: 'h',
  reporter_discord_id: A,
  contest_report_list: [],
});

// Seat 1 came in for D, whose row follows it; seats 2 and 3 tie for second.
const ffa = match([
  player({ discord_id: A, placement: 0, team: 0, is_sub: true }),
  player({ discord_id: D, placement: 0, team: 0, subbed_out: true }),
  player({ discord_id: B, placement: 1, team: 1 }),
  player({ discord_id: '-7656', user_name: 'Gandhi fan', placement: 1, team: 2 }),
]);

const picks =
  (chosen: Record<string, string>) =>
  (field: string): string | null =>
    chosen[field] ?? null;

test('only changed places count, and each trades places with the holder', () => {
  // Seats 2 and 3 are tied for 2nd; untouched, nothing is sent.
  assert.deepEqual(orderEdits(ffa, 0, picks({ place1: '1', place2: '2', place3: '3' })), { ok: true, seats: [] });
  // Seat 3 to 1st: seat 1 takes its 2nd place, so the tie for 2nd stands.
  assert.deepEqual(orderEdits(ffa, 0, picks({ place1: '3', place2: '2', place3: '3' })), {
    ok: true,
    seats: [
      { seat: 0, placement: 1 },
      { seat: 3, placement: 0 },
    ],
  });
  assert.deepEqual(orderEdits(ffa, 0, picks({ place1: '2', place2: '1', place3: '2' })), {
    ok: false,
    reason: 'Seat 2 is picked for two places.',
  });
});

const teamer = match(
  [
    player({ discord_id: A, team: 0, placement: 1 }),
    player({ discord_id: B, team: 0, placement: 1 }),
    player({ discord_id: C, team: 1, placement: 0 }),
    player({ discord_id: D, team: 1, placement: 0 }),
  ],
  'Teamer',
);

test('a teamer is ordered by team, and every member moves with it', () => {
  const order = orderEdits(teamer, 0, picks({ place1: '1' }));
  assert.ok(order.ok);
  assert.deepEqual(
    order.seats.map((s) => [s.seat, s.placement]),
    [[2, 1], [3, 1], [0, 0], [1, 0]],
  );
});

test('a page leaves places and ties on other pages alone, and labels places as they stand', () => {
  const seven = match(Array.from({ length: 7 }, (_, i) => player({ discord_id: `-${i + 1}`, placement: Math.min(i, 5), team: i })));
  const order = orderEdits(seven, 0, picks({ place1: '2' }));
  assert.deepEqual(order, {
    ok: true,
    seats: [
      { seat: 0, placement: 1 },
      { seat: 1, placement: 0 },
    ],
  });
  const second = JSON.stringify(orderForm(seven, new Map(), new Map(), 1)?.toJSON());
  assert.match(second, /"label":"6th place".*"label":"6th place"/);
});

test('a tie puts the chosen seats level at the place; the rest keep their order', () => {
  assert.deepEqual(tieEdits(ffa, 1, [1, 3]), [{ seat: 3, placement: 0 }]);
  assert.deepEqual(tieEdits(ffa, 2, [2, 3]), []);
  // Two teams tied leave one place, so only 1st is offered.
  assert.match(JSON.stringify(tieForm(teamer, new Map(), new Map()).toJSON()), /"custom_id":"place","required":true,"options":\[\{"label":"1st","value":"1"\}\]/);
});

test('a seat form, named by seat number, sends only what changed', () => {
  assert.deepEqual(seatEdits(ffa, 2, { player: B, place: 1, shown: 1, quit: false, left: null }), []);
  assert.deepEqual(seatEdits(ffa, 3, { player: C, place: 1, shown: 1, quit: true, left: null }), [{ seat: 3, discord_id: C, quit: true }]);
  // Clearing a registered leaver removes the sub; naming another replaces it.
  assert.deepEqual(seatEdits(ffa, 1, { player: A, place: 0, shown: 0, quit: false, left: null }), [{ seat: 0, sub_out: null }]);
  assert.deepEqual(seatEdits(ffa, 1, { player: A, place: 0, shown: 0, quit: false, left: C }), [{ seat: 0, sub_out: C }]);
  assert.deepEqual(seatEdits(ffa, 9, { player: A, place: 0, shown: 0, quit: false, left: null }), []);
});

test('picking a player who holds another seat swaps the two in one save', () => {
  assert.deepEqual(seatEdits(ffa, 1, { player: B, place: 0, shown: 0, quit: false, left: D }), [
    { seat: 0, discord_id: B },
    { seat: 2, discord_id: A },
  ]);
  // An unassigned seat has no player to give back, so core-api decides.
  assert.deepEqual(seatEdits(ffa, 3, { player: A, place: 1, shown: 1, quit: false, left: null }), [{ seat: 3, discord_id: A }]);
});

test('the editor fits Discord and only real seats get a form', () => {
  const panel = editorPanel(ffa, new Map(), new Map(), false);
  assert.ok(container(panel).toJSON().components.length < 40);
  assert.equal(panel.footer, undefined);
  assert.doesNotMatch(JSON.stringify(container(panel).toJSON()), /Staff actions|Set a tie/);
  assert.ok(seatForm(ffa, 1, new Map()));
  assert.equal(seatForm(ffa, 4, new Map()), null);
});

// The buttons a panel shows, in order, wherever its rows sit.
const buttonsOf = (panel: Panel): string[] =>
  JSON.stringify(container(panel).toJSON())
    .match(/"label":"[^"]+"/g)
    ?.map((l) => l.slice(9, -1)) ?? [];

// A cloud game: twelve seats, none of them known to the save.
const cloud = match(Array.from({ length: 12 }, (_, i) => player({ discord_id: `-${i + 1}`, user_name: null, placement: i, team: i })));

test('players are assigned five seats per form, with every page a button', () => {
  const panel = editorPanel(cloud, new Map([['LEADER_SHAKA', 'Shaka']]), new Map(), true);
  assert.deepEqual(buttonsOf(panel).filter((l) => !/^\d+\. /.test(l)), [
    'Order 1\u20135',
    'Order 6\u201310',
    'Order 11\u201312',
    'Assign 1\u20135',
    'Assign 6\u201310',
    'Assign 11\u201312',
    'Quits',
    'Set a tie',
  ]);
  assert.match(JSON.stringify(container(panel).toJSON()), /"content":"\*\*Staff actions\*\*"/);
  assert.ok(container(panel).toJSON().components.length < 40);
  const last = assignForm(cloud, new Map(), 2)?.toJSON();
  assert.equal(last?.title, 'Assign players: seats 11\u201312');
  assert.equal(last?.components.length, 2);
  assert.match(JSON.stringify(last), /Seat 11 \u00b7 Shaka.*No player name in the save/);
  assert.equal(assignForm(cloud, new Map(), 3), null);
  assert.equal(assignForm(ffa, new Map(), 0)?.toJSON().title, 'Assign players');
});

test('an assign form saves only the seats whose player changed', () => {
  const picks: Record<string, string> = { seat1: A, seat2: C };
  assert.deepEqual(
    assignEdits(ffa, 0, (field) => picks[field] ?? null),
    [{ seat: 2, discord_id: C }],
  );
  assert.deepEqual(assignEdits(cloud, 1, () => null), []);
});

test('the forms name players by server name, with portraits, and say who is unassigned', () => {
  const members = new Map([[A, 'Calcifer']]);
  assert.equal(seatForm(ffa, 1, members)?.toJSON().title, 'Seat 1: Calcifer');
  const form = orderForm(ffa, new Map([['LEADER_SHAKA', '<:Shaka:9> Shaka']]), members, 0)?.toJSON();
  assert.equal(form?.title, 'Set the finishing order');
  const json = JSON.stringify(form);
  assert.match(json, /"label":"1st place"/);
  assert.match(json, /"label":"1\. Calcifer","value":"1","description":"Shaka","emoji":\{"id":"9","name":"Shaka"\},"default":true/);
  assert.match(json, /"label":"3\. Gandhi fan \(unassigned\)"/);
  assert.equal(orderForm(ffa, new Map(), members, 1), null);
});

test('a seat moved to another place trades with the seat there, merged with its other edits', () => {
  // Seat 1 (1st) to 2nd: seat 2 holds 2nd first, so it takes 1st.
  assert.deepEqual(seatEdits(ffa, 1, { player: A, place: 1, shown: 0, quit: true, left: D }), [
    { seat: 0, quit: true, placement: 1 },
    { seat: 2, placement: 0 },
  ]);
  // A form still showing the place it opened with moves nothing, even if
  // someone else has moved the seat since.
  assert.deepEqual(seatEdits(ffa, 1, { player: A, place: 1, shown: 1, quit: true, left: D }), [{ seat: 0, quit: true }]);
  const form = JSON.stringify(seatForm(ffa, 3, new Map([[A, 'Calcifer']]))?.toJSON());
  assert.match(form, /"label":"1st","value":"0","description":"Now: Calcifer","default":false/);
  assert.match(form, /"label":"2nd","value":"1","description":"Now: steam, Gandhi fan \(unassigned\)","default":true/);
});

test('quits are marked in one form, for seats with a player', () => {
  assert.deepEqual(quitEdits(ffa, ['2']), [{ seat: 2, quit: true }]);
  assert.deepEqual(quitEdits(ffa, []), []);
  assert.equal(quitsForm(cloud, new Map(), new Map()), null);
  assert.doesNotMatch(JSON.stringify(quitsForm(ffa, new Map(), new Map())?.toJSON()), /Gandhi fan/);
});

test('staff add a leader the civ data lacks by typing its name', () => {
  const names = new Map([
    ['LEADER_SEJONG', 'Sejong'],
    ['LEADER_CATHERINE_DE_MEDICI', 'Catherine de Medici (Black Queen)'],
    ['LEADER_CATHERINE_DE_MEDICI_ALT', 'Catherine de Medici (Magnificence)'],
    ['CIVILIZATION_KOREA', 'Korea'],
  ]);
  // Every seat holds LEADER_SHAKA, which these names do not know.
  const panel = editorPanel(ffa, names, new Map(), true);
  assert.ok(buttonsOf(panel).includes('Add missing civs'));
  assert.equal(civsForm(ffa, names, new Map(), 0)?.toJSON().components.length, 3);
  const typed = (entries: Record<string, string>) => (field: string) => entries[field] ?? '';
  assert.deepEqual(civEdits(ffa, names, typed({ civ1: 'sejong', civ3: ' ' })), { ok: true, seats: [{ seat: 0, leader: 'LEADER_SEJONG' }] });
  assert.deepEqual(civEdits(ffa, names, typed({ civ2: 'catherine' })), {
    ok: false,
    reason:
      'Seat 2: "catherine" could be Catherine de Medici (Black Queen) (LEADER_CATHERINE_DE_MEDICI), ' +
      'Catherine de Medici (Magnificence) (LEADER_CATHERINE_DE_MEDICI_ALT). Type the one in brackets.',
  });
  assert.deepEqual(civEdits(ffa, names, typed({ civ2: 'Gandhi' })), { ok: false, reason: 'Seat 2: no leader is called "Gandhi".' });
  // Known civs, or no civ data at all, leave nothing to add.
  assert.equal(civsForm(ffa, new Map([['LEADER_SHAKA', 'Shaka']]), new Map(), 0), null);
  assert.equal(civsForm(ffa, new Map(), new Map(), 0), null);
  // Twelve unknown seats come five to a form, and the last page is reachable.
  const known = new Map([['LEADER_SEJONG', 'Sejong']]);
  assert.ok(buttonsOf(editorPanel(cloud, known, new Map(), true)).includes('Missing civs 3/3'));
  assert.equal(civsForm(cloud, known, new Map(), 2)?.toJSON().components.length, 2);
});
