import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { Match, MatchUpload } from '../../api/types.js';
import { container, type Panel } from '../kit/index.js';
import { MARK, ageLabel, duplicateText, mapLabel, ordinal, playerIds, reportId, reportLabel, reportPanel, revertedPanel } from './report.js';

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
  assert.match(body, /^\u{1f947} <@100000000000000001> \u2014 Shaka\n-# \u0394 \+14 lifetime \u00b7 \u0394 \+9 season$/mu);
  assert.match(body, /^\u{1f948} <@100000000000000002> /mu);
  assert.match(body, /-# \u0394 \u22126 lifetime \u00b7 \u0394 \u22124 season/);
  assert.equal(panel.tone, 'info');
  assert.equal(panel.title, 'Civ6 FFA report');
  assert.equal(panel.actions?.length, 1);
  assert.ok(container(panel).toJSON().components.length < 40);
  assert.equal(panel.footer, 'Reported by <@100000000000000001> \u00b7 <t:1792670400:f>');
});

test('an unassigned seat is marked, and turns the panel orange for staff', () => {
  const m = match({ players: [player({ discord_id: '-76561190000000001', user_name: 'Gandhi fan' }), player({ discord_id: B, placement: 1, team: 1 })] });
  const panel = reportPanel({ match: m, names: new Map() });
  assert.equal(panel.tone, 'refused');
  assert.match(bodyOf(panel), new RegExp(`\`Gandhi fan\` ${MARK.unassigned} \u2014 Shaka\n-# \u0394 \u00b10 lifetime`));
  assert.match(bodyOf(panel), /\*\*For staff\*\*\n.*1 seat is unassigned\. Use Edit to assign it before approving\./);
});

test('a quit and a sub are marked on the name and spelled out for staff, not on the rating line', () => {
  const m = match({
    players: [
      player({ discord_id: C, is_sub: true, quit: true }),
      player({ discord_id: A, subbed_out: true }),
      player({ discord_id: B, placement: 1, team: 1 }),
    ],
  });
  const second = new Map([[C, { discord_id: C, count: 1, limit: 3, window_days: 30 }]]);
  const panel = reportPanel({ match: m, names: new Map(), quotas: second });
  const body = bodyOf(panel);
  assert.match(body, new RegExp(`<@${C}> ${MARK.quit} ${MARK.sub} \u2014 Shaka\n-# \u0394 \u00b10 lifetime \u00b7 \u0394 \u00b10 season\n`));
  assert.doesNotMatch(body, /^\*\*\d+\.\*\* <@100000000000000001>/m);
  assert.match(body, new RegExp(`${MARK.quit} <@${C}> quit\.`));
  assert.match(body, new RegExp(`${MARK.sub} <@${C}> subbed in for <@${A}> \u00b7 sub-in 2 of 3 in 30 days\.`));
  assert.equal(panel.tone, 'info');

  const fourth = new Map([[C, { discord_id: C, count: 3, limit: 3, window_days: 30 }]]);
  const over = reportPanel({ match: m, names: new Map(), quotas: fourth });
  assert.match(bodyOf(over), new RegExp(`${MARK.oversub} <@${C}> subbed in for <@${A}>: 4th sub-in in 30 days \\(limit 3\\)\\. Oversub applies\\.`));
  assert.equal(over.tone, 'refused');
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
  assert.ok(body.startsWith('\u{1f947} **Team 2**\n'));
  assert.match(body, /\n\n\*\*Team 1\*\* \u00b7 2nd\n/);
});

test('a row shows the portrait alone, and the name only where there is no portrait', () => {
  const names = new Map([['LEADER_SHAKA', '<:Shaka:9> Shaka']]);
  assert.match(bodyOf(reportPanel({ match: match(), names })), /<@100000000000000001> \u2014 <:Shaka:9>\n/);
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
  assert.match(panel.footer ?? '', /approved by <@100000000000000003> \u00b7 <t:1792674000:f>$/);
  assert.match(bodyOf(panel), /combined/);
  assert.doesNotMatch(bodyOf(panel), /For staff/);
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
  // The modes each reporting channel shows, as the parsers name them.
  for (const [game, mode, label] of [
    ['civ6', 'ffa', 'Civ6 FFA'],
    ['civ6', 'teamer', 'Civ6 Teamer'],
    ['civ6', 'duel', 'Civ6 Duel'],
    ['civ7', 'ffa', 'Civ7 FFA'],
    ['civ7', 'teamer', 'Civ7 Teamer'],
    ['civ7', 'Duel', 'Civ7 Duel'],
  ] as const) {
    assert.equal(reportLabel(match({ game, game_mode: mode })), label);
  }
  assert.equal(mapLabel('pangaea_ultima'), 'Pangaea Ultima');
  assert.equal(mapLabel('Seven_Seas'), 'Seven Seas');
  assert.equal(mapLabel('Seven Seas'), 'Seven Seas');
});

test('a revert names whose ratings came back', () => {
  const panel = revertedPanel(match());
  assert.equal(panel.title, 'Civ6 FFA result reverted');
  assert.match(bodyOf(panel), /restored for <@100000000000000002> \u00b7 <@100000000000000001>\./);
});

test('staff are told of a leader the civ data does not know, and only while pending', () => {
  const names = new Map([['LEADER_SEJONG', 'Sejong']]);
  const body = bodyOf(reportPanel({ match: match(), names }));
  assert.match(body, new RegExp(`${MARK.civ} <@${A}>: the civ data does not know \`LEADER_SHAKA\`\\.`));
  assert.doesNotMatch(bodyOf(reportPanel({ match: match(), names: new Map() })), /civ data/);
  const approved = match({ approved_at: '2026-10-22T13:00:00Z', approver_discord_id: C });
  assert.doesNotMatch(bodyOf(reportPanel({ match: approved, names })), /civ data/);
  // A civ7 seat whose leader is known but civ is not names the civ.
  const civ7 = match({ game: 'civ7', players: [player({ leader: 'LEADER_AMINA', civ: 'CIVILIZATION_X' }), player({ discord_id: B, leader: 'LEADER_AMINA', civ: 'CIVILIZATION_AKSUM', placement: 1, team: 1 })] });
  const known = new Map([['LEADER_AMINA', 'Amina'], ['CIVILIZATION_AKSUM', 'Aksum']]);
  assert.match(bodyOf(reportPanel({ match: civ7, names: known })), /does not know `CIVILIZATION_X`/);
});
