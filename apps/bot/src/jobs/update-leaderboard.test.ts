import { test } from 'node:test';
import assert from 'node:assert/strict';

import { getLeaderboardMessage } from './update-leaderboard.js';
import type { LeaderboardRanking } from '../api/types.js';

/**
 * The old renderer computed Win% as wins/games. `wins` counts games where
 * the rating went up, so that printed about 50% for every player on every
 * board, and `games - wins` was labelled "loss" without being one.
 *
 * What should break this file: computing a win rate from anything but
 * `first`, or labelling the rating-gain counter a win.
 */

const ranking = (games: number, wins: number, first: number): LeaderboardRanking =>
  ({
    rankings: [
      {
        rank: 1,
        discord_id: '123',
        mu: 1250,
        sigma: 8,
        games,
        rating: 1250,
        games_played: games,
        wins,
        first,
      },
    ],
    last_updated: 0,
  }) as unknown as LeaderboardRanking;

test('a duel win rate comes from first, not from rating gains', () => {
  // 7 wins in 10, while the rating rose in only 5 of them.
  const out = getLeaderboardMessage(ranking(10, 5, 7), 'duel', 0, 1);
  assert.match(out, /70\.0%/);
  assert.doesNotMatch(out, /50\.0%/);
});

test('a head-to-head loss column is games minus first', () => {
  const out = getLeaderboardMessage(ranking(10, 5, 7), 'teamer', 0, 1);
  assert.match(out, /\[\s*7 - 3\s*\]/);
});

test('head-to-head boards drop the duplicate first-place column', () => {
  const out = getLeaderboardMessage(ranking(10, 5, 7), 'duel', 0, 1);
  assert.match(out, /Rank {3}Skill\t\[wins - loss\]\tWin%/);
  assert.doesNotMatch(out, /1st/);
});

test('ffa keeps both counters and never calls the gain a win', () => {
  const out = getLeaderboardMessage(ranking(60, 30, 10), 'ffa', 0, 1);
  assert.match(out, /Games\t 1st\tWin%\t {3}\^/);
  assert.match(out, /16\.7%/);
  assert.doesNotMatch(out, /wins - loss/);
});

test('combined is treated as ffa, not as head-to-head', () => {
  const out = getLeaderboardMessage(ranking(60, 30, 10), 'combined', 0, 1);
  assert.match(out, /Games\t 1st\tWin%/);
});

test('no games is not a division by zero', () => {
  assert.match(getLeaderboardMessage(ranking(0, 0, 0), 'duel', 0, 1), /0\.0%/);
});
