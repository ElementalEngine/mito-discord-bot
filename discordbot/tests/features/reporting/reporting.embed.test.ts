import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  pickRankName,
  uniqueRatings,
} from '../../../src/features/reporting/rank-role.service.js';

test('pickRankName: threshold boundaries (CIV6 rank table)', () => {
  assert.equal(pickRankName(2400), 'Deity_3_STAR');
  assert.equal(pickRankName(2000), 'Deity');
  assert.equal(pickRankName(1500), 'King');
  assert.equal(pickRankName(1499), 'Prince'); // just below King
  assert.equal(pickRankName(999), 'Scout'); // below Builder floor
  assert.equal(pickRankName(Number.NaN), 'Scout'); // non-finite → lowest
});

test('uniqueRatings: de-dups by discord_id keeping the highest mu', () => {
  const out = uniqueRatings([
    { discord_id: '1', rating_mu: 1200 },
    { discord_id: '1', rating_mu: 1600 },
    { discord_id: '2', rating_mu: 1000 },
  ]);
  const byId = new Map(out.map((r) => [r.discord_id, r.rating_mu]));
  assert.equal(byId.get('1'), 1600);
  assert.equal(byId.get('2'), 1000);
  assert.equal(out.length, 2);
});

test('uniqueRatings: drops entries with empty id or non-finite mu', () => {
  const out = uniqueRatings([
    { discord_id: '', rating_mu: 1500 },
    { discord_id: '3', rating_mu: Number.NaN },
  ]);
  assert.equal(out.length, 0);
});
