import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { StatRow, UserStatsResponse } from '../../api/types.js';
import { formatRoomRanksPages } from '../layouts/roomranks.js';
import { statTable } from './stats.js';

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

test('wins are games that raised the rating, and 1st shows beside them in every mode', () => {
  const table = statTable(stats().lifetime);
  assert.match(lineOf(table, 'Wins'), /^Wins\s+30\s+6\s+\u2014$/);
  // A teamer sub-in gains on the losing side, so wins and firsts can differ.
  assert.match(lineOf(table, '1st place'), /^1st place\s+10\s+7\s+\u2014$/);
  assert.equal(table.split('\n').filter((l) => /^Rating gains/.test(l)).length, 0);
  assert.deepEqual(
    table.split('\n').slice(2, -1).map((l) => l.slice(0, 12).trim()),
    ['Skill', 'Sigma', 'Games', 'Wins', 'Losses', 'Win %', '1st place', 'Subbed in', 'Subbed out'],
  );
});

test('losses and win rate come from wins, in every mode', () => {
  const table = statTable(stats().lifetime);
  assert.match(lineOf(table, 'Losses'), /^Losses\s+30\s+4\s+\u2014$/);
  assert.match(lineOf(table, 'Win %'), /^Win %\s+50%\s+60%\s+\u2014$/);
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
