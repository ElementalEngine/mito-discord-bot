import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { Match } from '../../api/types.js';
import { container, type CivNames, type Panel } from '../kit/index.js';
import {
  civFocus,
  closedEditor,
  draftEdits,
  draftPanel,
  editorPanel,
  quitEdits,
  quitsForm,
  seatEdits,
  seatForm,
  tieEdits,
  tieForm,
  withAssignPick,
  withCivPick,
  withOrderPick,
  type DraftKind,
  type Members,
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

// A draft panel as the handler draws it, `base` being the match it opened on.
const panelOf = (kind: DraftKind, now: Match, names: CivNames = new Map(), members: Members = new Map(), base = now, focus = 1): Panel =>
  draftPanel({ kind, base, now, rev: 1, focus }, names, members);

test('a pick trades places with the holder, and only changed seats are sent', () => {
  // Seats 2 and 3 are tied for 2nd; untouched, nothing is sent.
  assert.deepEqual(draftEdits(ffa, ffa), []);
  assert.equal(withOrderPick(ffa, 0, 1, 1), ffa);
  // Seat 3 to 1st: seat 1 takes its 2nd place, so the tie for 2nd stands.
  assert.deepEqual(draftEdits(ffa, withOrderPick(ffa, 0, 1, 3)), [
    { seat: 0, placement: 1 },
    { seat: 3, placement: 0 },
  ]);
  // A second pick reads the order the first one left: seat 3 now holds 1st.
  const twice = withOrderPick(withOrderPick(ffa, 0, 1, 3), 0, 3, 2);
  assert.deepEqual(draftEdits(ffa, twice), [
    { seat: 0, placement: 1 },
    { seat: 2, placement: 0 },
  ]);
  // A pick from a menu drawn before the last pick still means its place.
  const three = match([player({ placement: 0, team: 0 }), player({ placement: 1, team: 1 }), player({ placement: 2, team: 2 })]);
  const moved = withOrderPick(three, 0, 1, 3);
  assert.equal(withOrderPick(moved, 2, 3, 1), moved);
  // Seat 2 to 3rd trades with seat 1, which holds 3rd now.
  assert.deepEqual(draftEdits(three, withOrderPick(moved, 2, 3, 2)), [
    { seat: 0, placement: 1 },
    { seat: 1, placement: 2 },
    { seat: 2, placement: 0 },
  ]);
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
  assert.deepEqual(
    draftEdits(teamer, withOrderPick(teamer, 0, 2, 1)).map((s) => [s.seat, s.placement]),
    [[0, 0], [1, 0], [2, 1], [3, 1]],
  );
  assert.match(JSON.stringify(container(panelOf('order', teamer)).toJSON()), /"label":"1st \u00b7 Team 2"/);
});

test('every place is one menu, ties labelled as they stand', () => {
  const seven = match(Array.from({ length: 7 }, (_, i) => player({ discord_id: `-${i + 1}`, placement: Math.min(i, 5), team: i })));
  assert.deepEqual(draftEdits(seven, withOrderPick(seven, 0, 1, 2)), [
    { seat: 0, placement: 1 },
    { seat: 1, placement: 0 },
  ]);
  const json = JSON.stringify(container(panelOf('order', seven)).toJSON());
  assert.equal((json.match(/"custom_id":"report:orderpick:/g) ?? []).length, 7);
  assert.match(json, /"label":"6th \u00b7 6\. steam \(unassigned\)","value":"6"[^}]*"default":true.*"label":"6th \u00b7 7\. steam \(unassigned\)","value":"7"[^}]*"default":true/);
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
  // An unassigned seat has no player to give back, so it is refused here.
  assert.equal(seatEdits(ffa, 3, { player: A, place: 1, shown: 1, quit: false, left: null }), `<@${A}> has seat 1. Give seat 1 another player first.`);
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

test('one button each for order and assign, however many seats', () => {
  const panel = editorPanel(cloud, new Map([['LEADER_SHAKA', 'Shaka']]), new Map(), true);
  assert.deepEqual(buttonsOf(panel).filter((l) => !/^\d+\. /.test(l)), [
    'Set order',
    'Assign players',
    'Quits',
    'Set a tie',
    'Set civs',
    'Done',
  ]);
  const json = JSON.stringify(container(panel).toJSON());
  assert.match(json, /"content":"\*\*Bulk edits\*\*".*"content":"\*\*Staff actions\*\*"/);
  assert.ok(container(panel).toJSON().components.length < 40);
});

test('a cloud game\'s twelve seats are assigned in one panel, then saved at once', () => {
  const names = new Map([['LEADER_SHAKA', 'Shaka']]);
  const json = JSON.stringify(container(panelOf('assign', cloud, names)).toJSON());
  assert.equal((json.match(/"custom_id":"report:assignpick:/g) ?? []).length, 12);
  assert.match(json, /"placeholder":"Seat 1 \u00b7 Shaka \u00b7 unassigned"/);
  assert.match(json, /"label":"Nothing to save","style":3,"disabled":true/);
  const draft = withAssignPick(cloud, withAssignPick(cloud, cloud, 1, A) as Match, 2, B) as Match;
  assert.deepEqual(draftEdits(cloud, draft), [
    { seat: 0, discord_id: A },
    { seat: 1, discord_id: B },
  ]);
  const shown = JSON.stringify(container(panelOf('assign', draft, names, new Map([[A, 'Calcifer']]), cloud)).toJSON());
  assert.match(shown, /Seat 1 \u00b7 Shaka \u00b7 now Calcifer/);
  assert.match(shown, new RegExp(`Not saved yet:\\*\\* Seat 1 \u2192 <@${A}> \u00b7 Seat 2 \u2192 <@${B}>.*"label":"Save 2 changes"`));
  // Moved to another empty seat, the seat left goes back to empty.
  assert.deepEqual(draftEdits(cloud, withAssignPick(cloud, draft, 3, A) as Match), [
    { seat: 1, discord_id: B },
    { seat: 2, discord_id: A },
  ]);
  assert.equal(withAssignPick(cloud, draft, 1, A), draft);
  // A seat the save filled cannot be left empty.
  assert.equal(withAssignPick(ffa, ffa, 3, A), `<@${A}> has seat 1. Give seat 1 another player first.`);
});

test('a game past fifteen seats still fits, the rest set one seat at a time', () => {
  const big = match(Array.from({ length: 17 }, (_, i) => player({ discord_id: `-${i + 1}`, placement: i, team: i })));
  for (const panel of [panelOf('assign', big), panelOf('order', big)]) {
    const json = JSON.stringify(container(panel).toJSON());
    assert.match(json, /Seats past 15 are set from \*\*Edit one seat\*\*/);
  }
});

test('the panels name players by server name, with portraits, and say who is unassigned', () => {
  const members = new Map([[A, 'Calcifer']]);
  assert.equal(seatForm(ffa, 1, members)?.toJSON().title, 'Seat 1: Calcifer');
  const panel = panelOf('order', ffa, new Map([['LEADER_SHAKA', '<:Shaka:9> Shaka']]), members);
  assert.equal(panel.title, 'Set order: Civ6 FFA report');
  const json = JSON.stringify(container(panel).toJSON());
  assert.match(json, /"label":"1st \u00b7 1\. Calcifer","value":"1","description":"Shaka","emoji":\{"id":"9","name":"Shaka"\},"default":true/);
  assert.match(json, /"label":"2nd \u00b7 3\. Gandhi fan \(unassigned\)"/);
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

// The sub on seat 1 (A) came in for D. Either, both or neither may have quit.
test('the seat form marks the quit of the player who left apart from the seat player', () => {
  const base = { player: A, place: 0, shown: 0, quit: false, left: D };
  assert.deepEqual(seatEdits(ffa, 1, { ...base, leftQuit: true }), [{ seat: 0, leaver_quit: true }]);
  assert.deepEqual(seatEdits(ffa, 1, { ...base, quit: true, leftQuit: true }), [{ seat: 0, quit: true, leaver_quit: true }]);
  assert.deepEqual(seatEdits(ffa, 1, { ...base, leftQuit: false }), []);
  // A new leaver named in the same form starts unmarked, so ticking sends it.
  assert.deepEqual(seatEdits(ffa, 1, { ...base, left: C, leftQuit: true }), [{ seat: 0, sub_out: C, leaver_quit: true }]);
  // Clearing the sub drops the leaver and their mark with it.
  assert.deepEqual(seatEdits(ffa, 1, { ...base, left: null, leftQuit: true }), [{ seat: 0, sub_out: null }]);
});

test('a leaver quit with nobody who left is refused before it is sent', () => {
  const lone = { player: B, place: 1, shown: 1, quit: false, left: null, leftQuit: true };
  assert.equal(seatEdits(ffa, 2, lone), 'Pick the player subbed out first, then mark that they quit.');
  const unregistered = match([
    player({ discord_id: A, placement: 0, team: 0, is_sub: true }),
    player({ discord_id: '-7656', placement: 0, team: 0, subbed_out: true }),
    player({ discord_id: B, placement: 1, team: 1 }),
  ]);
  assert.equal(
    seatEdits(unregistered, 1, { player: A, place: 0, shown: 0, quit: false, left: null, leftQuit: true }),
    'The player subbed out is not registered. Pick them in the Player subbed out box first.',
  );
});

test('the quits form lists the player who left as their own entry, one edit per seat', () => {
  const form = JSON.stringify(quitsForm(ffa, new Map(), new Map([[A, 'Calcifer'], [D, 'Busysnail']]))?.toJSON());
  assert.match(form, /"label":"1\. Busysnail \(subbed out\)","value":"1-left","description":"Replaced by Calcifer","default":false/);
  assert.deepEqual(quitEdits(ffa, ['1-left']), [{ seat: 0, leaver_quit: true }]);
  assert.deepEqual(quitEdits(ffa, ['1', '1-left']), [{ seat: 0, quit: true, leaver_quit: true }]);
  const marked = match(ffa.players.map((p, i) => (i === 1 ? { ...p, quit: true } : p)));
  assert.deepEqual(quitEdits(marked, []), [{ seat: 0, leaver_quit: false }]);
});

test('the editor shows a leaver\'s quit beside the leaver, not the sub', () => {
  const marked = match(ffa.players.map((p, i) => (i === 1 ? { ...p, quit: true } : p)));
  const text = JSON.stringify(editorPanel(marked, new Map(), new Map(), true).body);
  assert.match(text, new RegExp(`for <@${D}> \\(\\S+ quit\\)`));
  assert.doesNotMatch(text, new RegExp(`<@${A}>[^\\n]*\\u00b7 \\S+ quit \\u00b7`));
});

test('a repointed sub\'s quit box marks whoever is now in the subbed out box', () => {
  const marked = match(ffa.players.map((p, i) => (i === 1 ? { ...p, quit: true } : p)));
  // The box opened ticked for D. Changed to C, the form saves what it shows.
  assert.deepEqual(seatEdits(marked, 1, { player: A, place: 0, shown: 0, quit: false, left: C, leftQuit: true }), [{ seat: 0, sub_out: C, leaver_quit: true }]);
  assert.deepEqual(seatEdits(marked, 1, { player: A, place: 0, shown: 0, quit: false, left: C, leftQuit: false }), [{ seat: 0, sub_out: C }]);
});

test('an unchanged mark on an unregistered leaver does not block the rest of the form', () => {
  const legacy = match([
    player({ discord_id: A, placement: 0, team: 0, is_sub: true }),
    player({ discord_id: '-7656', placement: 0, team: 0, subbed_out: true, quit: true }),
    player({ discord_id: B, placement: 1, team: 1 }),
  ]);
  assert.deepEqual(seatEdits(legacy, 1, { player: A, place: 1, shown: 0, quit: false, left: null, leftQuit: true }), [
    { seat: 0, placement: 1 },
    { seat: 2, placement: 0 },
  ]);
});

test('a leaver row after a seat not marked as a sub is not offered, as core-api would refuse it', () => {
  const unpaired = match([
    player({ discord_id: A, placement: 0, team: 0 }),
    player({ discord_id: D, placement: 0, team: 0, subbed_out: true }),
    player({ discord_id: B, placement: 1, team: 1 }),
  ]);
  assert.doesNotMatch(JSON.stringify(quitsForm(unpaired, new Map(), new Map())?.toJSON()), /1-left/);
  assert.deepEqual(quitEdits(unpaired, ['1-left']), []);
});

test('a quits list longer than a menu holds stops at 25, and seats past it keep their marks', () => {
  const ids = Array.from({ length: 13 }, (_, i) => String(200000000000000000n + BigInt(i)));
  const left = Array.from({ length: 13 }, (_, i) => String(300000000000000000n + BigInt(i)));
  const big = match(
    ids.flatMap((id, i) => [
      player({ discord_id: id, placement: i, team: i, is_sub: true }),
      player({ discord_id: left[i], placement: i, team: i, subbed_out: true, quit: i === 12 }),
    ]),
  );
  const form = quitsForm(big, new Map(), new Map())?.toJSON() as { components: { component: { options: unknown[]; max_values: number } }[] };
  assert.equal(form.components[0]!.component.options.length, 25);
  assert.equal(form.components[0]!.component.max_values, 25);
  // Seat 13's leaver is past the list: an empty pick does not clear their quit.
  assert.deepEqual(quitEdits(big, []), []);
});

test('the seat form asks who played, their place, who they replaced, then who quit', () => {
  const marked = match(ffa.players.map((p, i) => (i === 1 ? { ...p, quit: true } : p)));
  const form = seatForm(marked, 1, new Map([[A, 'Calcifer'], [D, 'Busysnail']]))?.toJSON() as {
    components: { label: string; component: { max_values?: number; options?: { value: string; default?: boolean; description?: string }[] } }[];
  };
  assert.deepEqual(form.components.map((c) => c.label), ['Player', 'Place', 'Player subbed out (optional)', 'Did they quit? (optional)']);
  const quit = form.components[3]!.component.options!;
  assert.deepEqual(quit.map((o) => [o.value, o.default]), [['player', false], ['left', true]]);
  assert.equal(form.components[3]!.component.max_values, 2);
  // The options name the form's boxes: a form cannot update names as they change.
  assert.equal(quit[1]!.description, 'The player in the subbed out box left early');
});

// Ninety leaders, as civ6 has, so the picker needs more than one menu.
const leaders = new Map(
  Array.from({ length: 90 }, (_, i): [string, string] => [`LEADER_X${i}`, `${String.fromCharCode(65 + (i % 26))}${i}`]),
);
leaders.set('LEADER_SHAKA', '<:Shaka:9> Shaka');

test('staff pick civs from menus of every known leader, 25 at most each', () => {
  const panel = panelOf('civs', ffa, leaders);
  const json = JSON.stringify(container(panel).toJSON());
  const menus = [...json.matchAll(/"custom_id":"report:civpick:[^"]*:1:leader(\d):1"[^\]]*?"options":\[(.*?)\]/g)];
  assert.equal(menus.length, 4);
  for (const [, , options] of menus) assert.ok((options!.match(/"value":/g) ?? []).length <= 25);
  assert.match(json, /"placeholder":"Leaders A\u2013/);
  // The seat's own leader is the one picked, with its portrait.
  assert.match(json, /"label":"Shaka","value":"LEADER_SHAKA","default":true,"emoji":\{"id":"9","name":"Shaka"\}/);
  assert.match(json, /"label":"1\. [^"]*","value":"1","description":"Shaka","emoji":\{[^}]*\},"default":true/);
  assert.ok(container(panel).toJSON().components.length < 40);
  assert.match(json, /"label":"Nothing to save","style":3,"disabled":true.*"label":"Back to the editor"/);
});

test('a civ7 seat gets a leader and a civ menu; an unknown one says so', () => {
  const civ7: Match = { ...match([player({ leader: 'LEADER_AMINA', civ: 'CIVILIZATION_AKSUM' })]), game: 'civ7' };
  const names = new Map([
    ['LEADER_AMINA', 'Amina'],
    ['CIVILIZATION_ROME', 'Rome'],
  ]);
  const json = JSON.stringify(container(panelOf('civs', civ7, names)).toJSON());
  assert.match(json, /"placeholder":"Leaders A"/);
  assert.match(json, /"placeholder":"Civs R"/);
  assert.match(json, /not in the civ data: `CIVILIZATION_AKSUM`/);
  // Each kind of menu sits under its own heading.
  assert.match(json, /\*\*Leader\*\*.*"placeholder":"Leaders A".*\*\*Civ\*\*.*"placeholder":"Civs R"/);
  // Without civ data there is nothing to pick from, and it says so.
  assert.match(JSON.stringify(container(panelOf('civs', ffa)).toJSON()), /civ data is unavailable/);
});

test('the picker opens on an unknown seat and moves on once it is known', () => {
  const names = new Map([['LEADER_SEJONG', 'Sejong']]);
  const m = match([
    player({ leader: 'LEADER_SEJONG' }),
    player({ discord_id: B, leader: 'LEADER_SHAKA', placement: 1, team: 1 }),
    player({ discord_id: C, leader: 'LEADER_GANDHI', placement: 2, team: 2 }),
  ]);
  assert.equal(civFocus(m, names), 2);
  assert.equal(civFocus(m, names, 2), 2);
  assert.equal(civFocus(m, names, 1), 2);
  assert.equal(civFocus(m, names, 3), 3);
  const known = match([player({ leader: 'LEADER_SEJONG' }), player({ discord_id: B, leader: 'LEADER_SEJONG', placement: 1, team: 1 })]);
  assert.equal(civFocus(known, names), 1);
  assert.equal(civFocus(known, names, 2), 2);
});

test('a pick sets the leader or the civ in the draft, and Save sends them together', () => {
  const draft = withCivPick(withCivPick(ffa, 1, 'LEADER_SEJONG'), 2, 'CIVILIZATION_ROME');
  assert.deepEqual(draftEdits(ffa, draft), [
    { seat: 0, leader: 'LEADER_SEJONG' },
    { seat: 2, civ: 'CIVILIZATION_ROME' },
  ]);
  assert.equal(withCivPick(ffa, 1, 'LEADER_SHAKA'), ffa);
  assert.equal(withCivPick(ffa, 9, 'LEADER_SEJONG'), ffa);
  const json = JSON.stringify(container(panelOf('civs', draft, new Map([['LEADER_SEJONG', 'Sejong']]), new Map(), ffa)).toJSON());
  assert.match(json, /Not saved yet:\*\* Seat 1 \u2192 Sejong.*"label":"Save 2 changes"/);
});

test('players trade seats with their own quit marks', () => {
  const m = match([
    player({ discord_id: A, placement: 0, team: 0, quit: true }),
    player({ discord_id: B, placement: 1, team: 1 }),
    player({ discord_id: C, placement: 2, team: 2 }),
    player({ discord_id: D, placement: 3, team: 3 }),
    player({ discord_id: '100000000000000005', placement: 4, team: 4 }),
    player({ discord_id: '100000000000000006', placement: 5, team: 5 }),
  ]);
  // Seat 2 takes A from seat 1: A keeps the quit, B leaves it behind.
  assert.deepEqual(seatEdits(m, 2, { player: A, place: 1, shown: 1, quit: false, left: null }), [
    { seat: 1, discord_id: A, quit: true },
    { seat: 0, discord_id: B, quit: false },
  ]);
  assert.deepEqual(draftEdits(m, withAssignPick(m, m, 2, A) as Match), [
    { seat: 0, discord_id: B, quit: false },
    { seat: 1, discord_id: A, quit: true },
  ]);
  // One team cannot tie.
  const lone = match([player({ discord_id: A, team: 0 }), player({ discord_id: B, team: 0 })], 'Teamer');
  assert.ok(!buttonsOf(editorPanel(lone, new Map(), new Map(), true)).includes('Set a tie'));
});

test('the editor and civ picker show a civ7 seat\'s leader and civ, as the report does', () => {
  const civ7: Match = { ...match([player({ leader: 'LEADER_AMINA', civ: 'CIVILIZATION_ROME' })]), game: 'civ7' };
  const names = new Map([
    ['LEADER_AMINA', '<:Amina:1> Amina'],
    ['CIVILIZATION_ROME', '<:Rome:2> Rome'],
  ]);
  for (const panel of [editorPanel(civ7, names, new Map(), true), panelOf('civs', civ7, names)]) {
    assert.match(JSON.stringify(container(panel).toJSON()), /<:Amina:1> <:Rome:2> \u2014 1st/);
  }
});


test('a closed editor says whether its unsaved changes were kept', () => {
  assert.equal(closedEditor().tone, 'muted');
  assert.equal(closedEditor('saved').tone, 'success');
  assert.match(JSON.stringify(closedEditor('saved').body), /unsaved changes were saved/);
  const lost = closedEditor({ notSaved: 'Could not save your unsaved changes: Assign seat 1 first.' });
  assert.equal(lost.tone, 'failed');
  assert.match(JSON.stringify(lost.body), /Assign seat 1 first\. Press Edit on the report/);
});
