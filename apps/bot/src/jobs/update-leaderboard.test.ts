import { test } from 'node:test';
import assert from 'node:assert/strict';

import { leaderboardsList } from '../data/leaderboards-list.data.js';
import { boardName } from './update-leaderboard.js';

test('every board is named by its edition, type and mode, never by a raw key', () => {
  const names = leaderboardsList.map(boardName);
  for (const name of names) assert.match(name, /^Civ[67] (Realtime|Cloud) (FFA|Duel|Teamer|Combined)$/, name);
  // A seasonal board shares its name with its lifetime board; the season is added later.
  assert.equal(new Set(names).size, leaderboardsList.filter((b) => !b.is_seasonal).length);
});
