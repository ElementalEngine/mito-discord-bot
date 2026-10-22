import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { Match } from '../../api/types.js';
import { container } from '../kit/index.js';
import { editorPanel, orderOf, parseOrder, seatEdit, seatForm } from './report-edit.js';

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

test('a seat form sends only what changed', () => {
  assert.equal(seatEdit(ffa, 2, { player: B, quit: false, left: null }), null);
  assert.deepEqual(seatEdit(ffa, 3, { player: C, quit: true, left: null }), { seat: 3, discord_id: C, quit: true });
  // Clearing a registered leaver removes the sub; naming another replaces it.
  assert.deepEqual(seatEdit(ffa, 0, { player: A, quit: false, left: null }), { seat: 0, sub_out: null });
  assert.deepEqual(seatEdit(ffa, 0, { player: A, quit: false, left: C }), { seat: 0, sub_out: C });
  assert.equal(seatEdit(ffa, 1, { player: A, quit: false, left: null }), null);
});

test('the editor fits Discord and only real seats get a form', () => {
  const panel = editorPanel(ffa, new Map(), false);
  assert.ok(container(panel).toJSON().components.length < 40);
  assert.equal(panel.footer, 'Ties are set by staff.');
  assert.ok(seatForm(ffa, 0));
  assert.equal(seatForm(ffa, 1), null);
});
