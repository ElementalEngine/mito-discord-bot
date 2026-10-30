import { test } from 'node:test';
import assert from 'node:assert/strict';

import { formatRoomRanksPages } from './roomranks.js';

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
