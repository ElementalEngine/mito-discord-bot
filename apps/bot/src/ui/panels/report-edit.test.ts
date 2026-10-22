import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { Match } from '../../api/types.js';
import { container } from '../kit/index.js';
import { assignEdits, assignForm, editorPanel, orderForm, orderOf, parseOrder, seatEdits, seatForm } from './report-edit.js';

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

test('the order reads best first, ties joined, the leaver row not a seat', () => {
  assert.equal(orderOf(ffa), '1 2=3');
});

test('a written order becomes one placement per seat', () => {
  const parsed = parseOrder(ffa, ' 3 1   2 ');
  assert.deepEqual(parsed, {
    ok: true,
    seats: [
      { seat: 0, placement: 1 },
      { seat: 2, placement: 2 },
      { seat: 3, placement: 0 },
    ],
  });
  assert.deepEqual(parseOrder(ffa, '2=3 1'), {
    ok: true,
    seats: [
      { seat: 0, placement: 1 },
      { seat: 2, placement: 0 },
      { seat: 3, placement: 0 },
    ],
  });
});

test('an order that misses, repeats or invents a seat is refused with what is wrong', () => {
  const bad = parseOrder(ffa, '1 1 4');
  assert.equal(bad.ok, false);
  assert.match(bad.ok ? '' : bad.reason, /missing 2, 3; repeated 1; no seat 4/);
  assert.match((parseOrder(ffa, '1 two 3') as { reason: string }).reason, /seat numbers/);
});

test('a teamer is ordered by team number', () => {
  const teamer = match(
    [
      player({ discord_id: A, team: 0, placement: 1 }),
      player({ discord_id: B, team: 0, placement: 1 }),
      player({ discord_id: C, team: 1, placement: 0 }),
      player({ discord_id: D, team: 1, placement: 0 }),
    ],
    'Teamer',
  );
  assert.equal(orderOf(teamer), '2 1');
  const parsed = parseOrder(teamer, '1 2');
  assert.ok(parsed.ok);
  assert.deepEqual(
    parsed.seats.map((s) => s.placement),
    [0, 0, 1, 1],
  );
});

test('a seat form, named by seat number, sends only what changed', () => {
  assert.deepEqual(seatEdits(ffa, 2, { player: B, quit: false, left: null }), []);
  assert.deepEqual(seatEdits(ffa, 3, { player: C, quit: true, left: null }), [{ seat: 3, discord_id: C, quit: true }]);
  // Clearing a registered leaver removes the sub; naming another replaces it.
  assert.deepEqual(seatEdits(ffa, 1, { player: A, quit: false, left: null }), [{ seat: 0, sub_out: null }]);
  assert.deepEqual(seatEdits(ffa, 1, { player: A, quit: false, left: C }), [{ seat: 0, sub_out: C }]);
  assert.deepEqual(seatEdits(ffa, 9, { player: A, quit: false, left: null }), []);
});

test('picking a player who holds another seat swaps the two in one save', () => {
  assert.deepEqual(seatEdits(ffa, 1, { player: B, quit: false, left: D }), [
    { seat: 0, discord_id: B },
    { seat: 2, discord_id: A },
  ]);
  // An unassigned seat has no player to give back, so core-api decides.
  assert.deepEqual(seatEdits(ffa, 3, { player: A, quit: false, left: null }), [{ seat: 3, discord_id: A }]);
});

test('the editor fits Discord and only real seats get a form', () => {
  const panel = editorPanel(ffa, new Map(), new Map(), false);
  assert.ok(container(panel).toJSON().components.length < 40);
  assert.equal(panel.footer, 'Ties are set by staff.');
  assert.ok(seatForm(ffa, 1, new Map()));
  assert.equal(seatForm(ffa, 4, new Map()), null);
});

// A cloud game: twelve seats, none of them known to the save.
const cloud = match(Array.from({ length: 12 }, (_, i) => player({ discord_id: `-${i + 1}`, user_name: null, placement: i, team: i })));

test('players are assigned five seats per form, with every page a button', () => {
  const panel = editorPanel(cloud, new Map(), new Map(), true);
  const labels = (panel.actions ?? []).flatMap((row) => row.toJSON().components.map((c) => ('label' in c ? c.label : null)));
  assert.deepEqual(labels.filter(Boolean), ['Set order', 'Assign 1\u20135', 'Assign 6\u201310', 'Assign 11\u201312']);
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

test('the forms name players by their server name, and say who is unassigned', () => {
  const members = new Map([[A, 'Calcifer']]);
  assert.equal(seatForm(ffa, 1, members)?.toJSON().title, 'Seat 1: Calcifer');
  const key = JSON.stringify(orderForm(ffa, new Map(), members).toJSON());
  assert.match(key, /`1` Calcifer \u2014 Shaka\\n`2` steam \u2014 Shaka\\n`3` Gandhi fan \(unassigned\) \u2014 Shaka/);
});
