import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { StatRow, UserStatsResponse } from '../../api/types.js';
import { formatRoomRanksPages } from '../layouts/roomranks.js';
import type { HistoryGame, HistoryPage, StatsSummary } from '../../api/types.js';
import { civLines, historyLine, historyPanel, mapTable, rankAccent, resetPanel, statTable, statsPanel, teamsPanel } from './stats.js';

/**
 * The stats panels read v2's counters (D164). What should break this file:
 * the rating-gain counter shown as a win, a head-to-head mode with a gains
 * column that repeats its wins, a season table on a cloud panel, or a room
 * table cut across a page.
 */

const row = (games: number, first: number, gains: number, mu = 1250): StatRow => ({
  mu,
  sigma: 8.4,
  games,
  first,
  rating_gains: gains,
  subbedIn: 1,
  subbedOut: 0,
});

const stats = (over: Partial<UserStatsResponse> = {}): UserStatsResponse => ({
  discord_id: '100000000000000001',
  civ_version: 'civ6',
  game_type: 'realtime',
  lifetime: { ffa: row(60, 10, 30, 1650), teamer: row(10, 7, 6), duel: null },
  season: { ffa: row(6, 1, 3) },
  ...over,
});

const lineOf = (table: string, label: string): string => {
  const line = table.split('\n').find((l) => l.startsWith(label));
  assert.ok(line, `no ${label} line`);
  return line;
};

test('wins are first places in every mode; rating gains only in ffa', () => {
  const table = statTable(stats().lifetime);
  assert.match(lineOf(table, 'Wins'), /^Wins\s+10\s+7\s+\u2014$/);
  assert.match(lineOf(table, 'Rating gains'), /^Rating gains\s+30\s+\u2014\s+\u2014$/);
});

test('losses and win rate come from first places, never from rating gains', () => {
  const table = statTable(stats().lifetime);
  assert.match(lineOf(table, 'Losses'), /^Losses\s+\u2014\s+3\s+\u2014$/);
  assert.match(lineOf(table, 'Win %'), /^Win %\s+17%\s+70%\s+\u2014$/);
});

test('a realtime panel shows lifetime and season, a cloud panel lifetime only', () => {
  const realtime = JSON.stringify(statsPanel(stats()).body);
  assert.match(realtime, /\*\*Lifetime\*\*/);
  assert.match(realtime, /\*\*Season\*\*/);
  const cloud = JSON.stringify(statsPanel(stats({ game_type: 'cloud' })).body);
  assert.match(cloud, /\*\*Lifetime\*\*/);
  assert.doesNotMatch(cloud, /\*\*Season\*\*/);
});

test('the panel takes the rank colour of the lifetime ffa rating', () => {
  assert.equal(statsPanel(stats()).accent, 0xf1c40f);
  assert.equal(rankAccent(null), undefined);
  assert.equal(statsPanel(stats({ lifetime: {} })).accent, undefined);
});

test('a reset shows the stats before it, then as they start again', () => {
  const fresh = { mu: 1200, sigma: 8, games: 0, first: 0, rating_gains: 0, subbedIn: 0, subbedOut: 0 };
  const panel = resetPanel({ ...stats(), after_lifetime: { ffa: fresh }, after_season: { ffa: fresh } });
  assert.equal(panel.tone, 'success');
  const body = JSON.stringify(panel.body);
  assert.ok(body.indexOf('Before \u00b7 Lifetime') < body.indexOf('After \u00b7 Lifetime'));
  assert.match(body, /Before \u00b7 Lifetime/);
  assert.match(body, /Before \u00b7 Season/);
  assert.match(body, /After \u00b7 Season/);
});

test('teams list their players and the match quality', () => {
  const panel = teamsPanel({ civ_version: 'civ7', game_type: 'cloud', game_quality: 0.8312, teams: [['1'], ['2', '3']] });
  assert.equal(panel.subtitle, 'Civ7 \u00b7 cloud \u00b7 match quality 0.83');
  assert.deepEqual(panel.body, [
    { kind: 'text', text: '**Team 1**\n<@1>' },
    { kind: 'text', text: '**Team 2**\n<@2>\n<@3>' },
  ]);
});

test('a long room splits into pages of whole tables, each under the limit', () => {
  const rows = Array.from({ length: 60 }, (_, i) => ({
    name: `Player number ${i}`,
    lifetime: { ffa: 1000 + i, teamer: null, duel: 900 },
    season: { ffa: 1000, teamer: null, duel: null },
  }));
  const pages = formatRoomRanksPages({ realtimeRows: rows, cloudLifetimeRows: null }, 1500);
  assert.ok(pages.length > 1);
  for (const page of pages) {
    assert.ok(page.length <= 1500);
    assert.equal(page.match(/```ansi/g)?.length, 2);
  }
  assert.equal(pages.join('').match(/Player number/g)?.length, 120);
});

const summary = (over: Partial<StatsSummary> = {}): StatsSummary => ({
  discord_id: '100000000000000001',
  civ_version: 'civ6',
  game_type: 'realtime',
  maps: [
    { map_type: 'Seven_Seas', games: 8, wins: 2 },
    { map_type: 'Pangaea', games: 3, wins: 3 },
  ],
  civs: [{ token: 'LEADER_TRAJAN', games: 4, wins: 1 }],
  ...over,
});

const NAMES = new Map([['LEADER_TRAJAN', '<:Trajan:123456789012345678> Trajan']]);

test('maps show games, wins, losses and win rate by first place', () => {
  const table = mapTable(summary());
  assert.match(lineOf(table.replace(/^```\n/, ''), 'Seven Seas'), /^Seven Seas\s+8\s+2\s+6\s+25%$/);
  assert.match(lineOf(table.replace(/^```\n/, ''), 'Pangaea'), /^Pangaea\s+3\s+3\s+0\s+100%$/);
});

test('the most played list names each pick with its portrait and win rate', () => {
  assert.equal(civLines(summary(), NAMES), '1. <:Trajan:123456789012345678> Trajan \u00b7 4 games \u00b7 1 wins (25%)');
});

test('the stats panel adds maps, leaders and the rank, and says when a reset started them', () => {
  const panel = statsPanel(stats(), summary({ since: '2026-09-01T00:00:00Z' }), NAMES);
  const body = JSON.stringify(panel.body);
  assert.match(body, /\*\*Maps\*\*/);
  assert.match(body, /\*\*Most played leaders\*\*/);
  assert.match(body, /\*\*Emperor\*\*/);
  assert.match(panel.footer ?? '', /since the reset on <t:1788220800:d>/);
  assert.doesNotMatch(JSON.stringify(statsPanel(stats(), summary({ maps: [], civs: [] })).body), /Maps/);
});

const game = (over: Partial<HistoryGame> = {}): HistoryGame => ({
  match_id: '1',
  reported_at: '2026-10-01T00:00:00Z',
  game_mode: 'ffa',
  map_type: 'Seven_Seas',
  leader: 'LEADER_TRAJAN',
  civ: 'CIVILIZATION_ROME',
  placement: 0,
  sides: 8,
  delta: 14,
  subbed_in: false,
  subbed_out: false,
  ...over,
});

test('a game line reads date, result, mode, pick, map and rating change', () => {
  assert.equal(
    historyLine(game(), 'civ6', NAMES),
    '<t:1790812800:d> \u00b7 **1st** of 8 \u00b7 FFA \u00b7 <:Trajan:123456789012345678> Trajan \u00b7 Seven Seas \u00b7 +14',
  );
  assert.match(historyLine(game({ game_mode: 'teamer', sides: 2, placement: 1, delta: -9 }), 'civ6', NAMES), /Lost \u00b7 Teamer/);
  assert.match(historyLine(game({ subbed_out: true }), 'civ6', NAMES), /Left/);
  assert.match(historyLine(game({ subbed_in: true }), 'civ6', NAMES), /subbed in$/);
  assert.match(historyLine(game({ leader: null, civ: null }), 'civ6', NAMES), /Unknown civ/);
});

const page = (over: Partial<HistoryPage> = {}): HistoryPage => ({
  discord_id: '100000000000000001',
  civ_version: 'civ6',
  game_type: 'realtime',
  page: 0,
  page_size: 20,
  has_more: true,
  games: [game()],
  ...over,
});

const OF = { civVersion: 'civ6', mode: 'realtime', target: '100000000000000001', asker: '100000000000000002' } as const;

test('history pages carry who asked, and only the ways that exist are open', () => {
  const panel = historyPanel(page(), OF, NAMES);
  const buttons = JSON.stringify(panel.actions);
  assert.match(buttons, /history:page:civ6:realtime:100000000000000001:1:100000000000000002/);
  assert.match(buttons, /"label":"Newer","style":2,"disabled":true/);
  assert.match(buttons, /"label":"Older","style":2,"disabled":false/);
  assert.equal(panel.subtitle, 'Civ6 \u00b7 realtime \u00b7 games 1\u20131, newest first');
  assert.equal(historyPanel(page({ has_more: false }), OF, NAMES).actions, undefined);
  assert.equal(historyPanel(page({ page: 1, games: [], has_more: false }), OF, NAMES).subtitle, 'Civ6 \u00b7 realtime');
});

