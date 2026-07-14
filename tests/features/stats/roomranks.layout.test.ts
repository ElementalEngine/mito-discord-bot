import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MAX_DISCORD_LEN } from '../../../src/core/config/constants.js';
import { formatRoomRanksPages } from '../../../src/features/stats/ui/roomranks.layout.js';
import type {
  RoomRanksLifetimeRow,
  RoomRanksRow,
} from '../../../src/features/stats/ui/roomranks.layout.js';

const row = (name: string, mu: number): RoomRanksRow => ({
  name,
  lifetime: { ffa: mu, teamer: mu - 50, duel: mu + 25 },
  season: { ffa: mu - 10, teamer: null, duel: mu + 5 },
});

const cloudRow = (name: string, mu: number): RoomRanksLifetimeRow => ({
  name,
  lifetime: { ffa: mu, teamer: null, duel: null },
});

test('formatRoomRanksPages returns a single "No users." page for an empty room', () => {
  const pages = formatRoomRanksPages({
    realtimeRows: [],
    cloudLifetimeRows: null,
  });

  assert.equal(pages.length, 1);
  assert.ok(pages[0]?.includes('No users.'));
});

test('formatRoomRanksPages renders both realtime tables and omits cloud when absent', () => {
  const pages = formatRoomRanksPages({
    subtitle: 'Voice: <#1> • Users: 2',
    realtimeRows: [row('Alice', 1600), row('Bob', 1450)],
    cloudLifetimeRows: null,
  });

  assert.equal(pages.length, 1);
  const page = pages[0] as string;
  assert.ok(page.includes('**Realtime — Lifetime ELO**'));
  assert.ok(page.includes('**Realtime — Season ELO**'));
  assert.ok(!page.includes('Cloud — Lifetime ELO'));
  assert.ok(page.includes('Voice: <#1> • Users: 2'));
});

test('formatRoomRanksPages adds the cloud table when cloud rows are supplied', () => {
  const pages = formatRoomRanksPages({
    realtimeRows: [row('Alice', 1600)],
    cloudLifetimeRows: [cloudRow('Alice', 1300)],
  });

  assert.ok((pages[0] as string).includes('**Cloud — Lifetime ELO**'));
});

test('formatRoomRanksPages paginates and never exceeds the Discord message limit', () => {
  const many = Array.from({ length: 60 }, (_, i) =>
    row(`LongDisplayName${i}`, 1500 + i)
  );

  const pages = formatRoomRanksPages({
    subtitle: 'Voice: <#1> • Users: 60',
    realtimeRows: many,
    cloudLifetimeRows: null,
  });

  assert.ok(pages.length > 1, 'expected the 60-user room to spill past one page');
  for (const page of pages) {
    assert.ok(
      page.length <= MAX_DISCORD_LEN,
      `page of ${page.length} chars exceeds the ${MAX_DISCORD_LEN} limit`
    );
  }
});

test('formatRoomRanksPages renders missing values as an em dash', () => {
  const pages = formatRoomRanksPages({
    realtimeRows: [
      { name: 'Ghost', lifetime: { ffa: null, teamer: null, duel: null }, season: {} },
    ],
    cloudLifetimeRows: null,
  });

  assert.ok((pages[0] as string).includes('—'));
});
