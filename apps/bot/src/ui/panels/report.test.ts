import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { Match, MatchUpload } from '../../api/types.js';
import { container, type Panel } from '../kit/index.js';
import { ageLabel, duplicateText, ordinal, playerIds, reportId, reportLabel, reportPanel, revertedPanel } from './report.js';

/**
 * The report panel: one message, edited in place. What should break this
 * file: a standing out of placement order, a sub shown as its own seat, a
 * report needing staff that does not say so, or buttons on an approved one.
 */

const ID = '652f1a2b3c4d5e6f7a8b9c0d';
const A = '100000000000000001';
const B = '100000000000000002';
const C = '100000000000000003';

type P = Match['players'][number];
const player = (over: Partial<P>): P => ({
  civ: 'LEADER_SHAKA',
  leader: 'LEADER_SHAKA',
  delta: 0,
  season_delta: 0,
  combined_delta: 0,
  discord_id: A,
  is_sub: false,
  subbed_out: false,
  quit: false,
  team: 0,
  placement: 0,
  user_name: 'steam',
  ...over,
});

const match = (over: Partial<Match> = {}): Match => ({
  match_id: ID,
  game: 'civ6',
  game_mode: 'FFA',
  is_cloud: false,
  turn: 142,
  map_type: 'Pangaea',
  age: null,
  players: [
    player({ discord_id: B, placement: 1, team: 1, delta: -6.4, season_delta: -4 }),
    player({ discord_id: A, placement: 0, team: 0, delta: 14.2, season_delta: 9 }),
  ],
  parser_version: '1',
  discord_messages_id_list: ['m'],
  created_at: '2026-10-22T12:00:00Z',
  flagged: false,
  save_file_hash: 'h',
  reporter_discord_id: A,
  contest_report_list: [],
  ...over,
});

const bodyOf = (panel: Panel): string => (panel.body ?? []).map((b) => ('text' in b ? b.text : '')).join('\n');

test('standings run in placement order with signed deltas', () => {
  const panel = reportPanel({ match: match(), names: new Map() });
  const body = bodyOf(panel);
  assert.ok(body.indexOf(`<@${A}>`) < body.indexOf(`<@${B}>`));
  assert.match(body, /^\*\*1\.\*\* <@100000000000000001> \u2014 Shaka\n-# \+14 lifetime \u00b7 \+9 season$/m);
  assert.match(body, /-# \u22126 lifetime \u00b7 \u22124 season/);
  assert.equal(panel.tone, 'info');
  assert.equal(panel.title, 'Civ6 FFA report');
  assert.equal(panel.actions?.length, 1);
  assert.ok(container(panel).toJSON().components.length < 40);
});

test('an unassigned seat turns the panel orange and says what to do', () => {
  const m = match({ players: [player({ discord_id: '-76561190000000001', user_name: 'Gandhi fan' }), player({ discord_id: B, placement: 1, team: 1 })] });
  const panel = reportPanel({ match: m, names: new Map() });
  assert.equal(panel.tone, 'refused');
  assert.match(bodyOf(panel), /`Gandhi fan` \u2014 Shaka\n-# .*unassigned/);
  assert.match(bodyOf(panel), /1 seat unassigned\. Use Edit to assign it\./);
});

test('a sub is shown on the seat it filled, and a fourth sub-in is flagged', () => {
  const m = match({
    players: [
      player({ discord_id: C, is_sub: true }),
      player({ discord_id: A, subbed_out: true }),
      player({ discord_id: B, placement: 1, team: 1 }),
    ],
  });
  const quotas = new Map([[C, { discord_id: C, count: 3, limit: 3, window_days: 30 }]]);
  const body = bodyOf(reportPanel({ match: m, names: new Map(), quotas }));
  assert.match(body, /<@100000000000000003> \u2014 Shaka\n-# .*sub for <@100000000000000001>/);
  assert.doesNotMatch(body, /^\*\*\d+\.\*\* <@100000000000000001>/m);
  assert.match(body, /<@100000000000000003>: 4th sub-in in 30 days \(limit 3\)\. Oversub applies\./);
});

test('teamers are grouped by team, best team first', () => {
  const m = match({
    game_mode: 'Teamer',
    players: [
      player({ discord_id: A, team: 0, placement: 1 }),
      player({ discord_id: B, team: 1, placement: 0 }),
      player({ discord_id: C, team: 1, placement: 0 }),
    ],
  });
  const body = bodyOf(reportPanel({ match: m, names: new Map() }));
  assert.ok(body.indexOf('**Team 2** \u00b7 1st') < body.indexOf('**Team 1** \u00b7 2nd'));
});

test('civ7 rows name the leader and the civ; the age is a word', () => {
  const m = match({
    game: 'civ7',
    age: 'AGE_ANTIQUITY',
    players: [player({ leader: 'LEADER_AMINA', civ: 'CIVILIZATION_AKSUM' }), player({ discord_id: B, placement: 1, team: 1 })],
  });
  const panel = reportPanel({ match: m, names: new Map() });
  assert.match(bodyOf(panel), /Amina \u00b7 Aksum/);
  assert.match(panel.subtitle ?? '', /turn 142 \u00b7 Pangaea \u00b7 Antiquity$/);
  assert.equal(ageLabel('Exploration'), 'Exploration');
});

test('a contest is listed for staff', () => {
  const m = match({ contest_report_list: [{ contestor_discord_id: B, reason: 'wrong order' }] });
  const panel = reportPanel({ match: m, names: new Map() });
  assert.equal(panel.tone, 'refused');
  assert.match(bodyOf(panel), /Contested by <@100000000000000002>: wrong order/);
});

test('an approved result is green, says who approved it, and has no buttons', () => {
  const m = match({ approved_at: '2026-10-22T13:00:00Z', approver_discord_id: C, is_cloud: true, game_mode: 'pbc-ffa' });
  const panel = reportPanel({ match: m, names: new Map() });
  assert.equal(panel.tone, 'success');
  assert.equal(panel.title, 'Civ6 PBC FFA result');
  assert.equal(panel.actions, undefined);
  assert.match(panel.footer ?? '', /approved by <@100000000000000003>/);
  assert.match(bodyOf(panel), /combined/);
  assert.deepEqual(playerIds(m), [B, A]);
});

test('a duplicate upload is told which of three cases it is', () => {
  const up = (over: Partial<MatchUpload>): MatchUpload => ({ ...match(), repeated: true, ...over });
  assert.match(duplicateText(up({ repeated_by: 'composition' })), /another save/);
  assert.match(duplicateText(up({ repeated_by: 'file', approved_at: '2026-10-01T00:00:00Z' })), /approved/);
  assert.match(duplicateText(up({ repeated_by: 'file' })), /waiting for approval/);
});

test('ids and words', () => {
  assert.equal(reportId('approve', ID), `report:approve:${ID}`);
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ordinal), ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd']);
  assert.equal(reportLabel(match({ game: 'civ7', game_mode: 'Duel' })), 'Civ7 Duel');
});

test('a revert names whose ratings came back', () => {
  const panel = revertedPanel(match());
  assert.equal(panel.title, 'Civ6 FFA result reverted');
  assert.match(bodyOf(panel), /restored for <@100000000000000002> \u00b7 <@100000000000000001>\./);
});
