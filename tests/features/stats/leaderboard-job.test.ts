import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { LeaderboardRanking } from '../../../src/core/api/types.js';
import {
  getLeaderboardMessage,
  isLeaderboardUpToDate,
  toUnixSeconds,
} from '../../../src/features/stats/jobs/update-leaderboard.js';

const ranking = (
  entries: readonly { discord_id: string; rating: number; games_played: number; wins: number; first: number }[],
  lastUpdated = 1_700_000_000
): LeaderboardRanking => ({
  rankings: [...entries],
  last_updated: lastUpdated,
});

test('getLeaderboardMessage emits the column header only on the first page', () => {
  const data = ranking([
    { discord_id: '1', rating: 1234.6, games_played: 10, wins: 6, first: 3 },
  ]);

  const first = getLeaderboardMessage(data, 0, 1);
  const second = getLeaderboardMessage(data, 10, 11);

  assert.ok(first.startsWith('`Rank   Skill'));
  assert.ok(!second.includes('`Rank   Skill'));
});

test('getLeaderboardMessage formats rating, W-L, win% and mentions', () => {
  const line = getLeaderboardMessage(
    ranking([
      { discord_id: '999', rating: 1234.6, games_played: 10, wins: 6, first: 3 },
    ]),
    0,
    1
  ).split('\n')[1] as string;

  assert.ok(line.includes('#1'));
  assert.ok(line.includes('1235'), 'rating is rounded, not truncated');
  assert.ok(line.includes('[   6 - 4   ]'));
  assert.ok(line.includes('60.0%'));
  assert.ok(line.endsWith('<@999>'));
});

test('getLeaderboardMessage emits a bare rank line for missing entries', () => {
  const lines = getLeaderboardMessage(ranking([]), 0, 2).split('\n');
  assert.equal(lines[1], '`#1`');
  assert.equal(lines[2], '`#2`');
});

test('getLeaderboardMessage reports 0.0% rather than dividing by zero', () => {
  const line = getLeaderboardMessage(
    ranking([{ discord_id: '1', rating: 1000, games_played: 0, wins: 0, first: 0 }]),
    0,
    1
  );
  assert.ok(line.includes('0.0%'));
});

test('toUnixSeconds passes seconds through and converts milliseconds', () => {
  assert.equal(toUnixSeconds(1_700_000_000), 1_700_000_000);
  assert.equal(toUnixSeconds(1_700_000_000_000), 1_700_000_000);
});

test('isLeaderboardUpToDate is true only when the thread is at or ahead of the backend', () => {
  const msg = (content: string) => ({ content }) as never;

  assert.equal(
    isLeaderboardUpToDate(ranking([], 1_700_000_000), msg('Last updated: <t:1700000000:F>')),
    true
  );
  assert.equal(
    isLeaderboardUpToDate(ranking([], 1_700_000_001), msg('Last updated: <t:1700000000:F>')),
    false
  );
});

test('isLeaderboardUpToDate treats an unparseable footer as stale', () => {
  const msg = (content: string) => ({ content }) as never;

  assert.equal(isLeaderboardUpToDate(ranking([]), msg('Placeholder for leaderboard entry.')), false);
  assert.equal(isLeaderboardUpToDate(ranking([]), msg('Last updated: <t:not-a-number:F>')), false);
});
