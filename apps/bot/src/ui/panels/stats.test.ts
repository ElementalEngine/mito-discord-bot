import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { StatRow, UserStatsResponse } from '../../api/types.js';
import { formatRoomRanksPages } from '../layouts/roomranks.js';
import { rankAccent, resetPanel, statTable, statsPanel, teamsPanel } from './stats.js';

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

test('a reset shows the stats as they stood before it', () => {
  const panel = resetPanel(stats());
  assert.equal(panel.tone, 'success');
  assert.match(JSON.stringify(panel.body), /Before the reset/);
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
