import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { StatRow, StatSet } from '../../../src/core/api/types.js';
import { buildStatsEmbed } from '../../../src/features/stats/ui/stats.embed.js';

const statRow = (mu: number): StatRow => ({
  mu,
  sigma: 8.333,
  games: 20,
  wins: 11,
  first: 5,
  subbedIn: 1,
  subbedOut: 0,
});

const set = (mu: number | null): StatSet =>
  mu === null ? {} : { ffa: statRow(mu), teamer: statRow(mu), duel: statRow(mu) };

test('buildStatsEmbed renders lifetime and season sections for realtime', () => {
  const embed = buildStatsEmbed({
    civVersion: 'civ6',
    mode: 'realtime',
    targetMention: '<@1>',
    lifetime: set(1600),
    season: set(1500),
  });

  const fields = embed.data.fields ?? [];
  const names = fields.map((f) => f.name);

  assert.deepEqual(names, [
    '\u200b',
    'FFA',
    'Teamer',
    'Duel',
    '\u200b',
    'FFA',
    'Teamer',
    'Duel',
  ]);
});

test('buildStatsEmbed renders only the PBC lifetime section for cloud', () => {
  const embed = buildStatsEmbed({
    civVersion: 'civ7',
    mode: 'cloud',
    targetMention: '<@1>',
    lifetime: set(1300),
    season: set(1300),
  });

  const names = (embed.data.fields ?? []).map((f) => f.name);
  assert.deepEqual(names, ['\u200b', 'PBC', 'PBC-Teamer', 'PBC-Duel']);
});

test('buildStatsEmbed colours the embed from the lifetime FFA rank threshold', () => {
  const deity3 = buildStatsEmbed({
    civVersion: 'civ6',
    mode: 'realtime',
    targetMention: '<@1>',
    lifetime: set(2400),
    season: set(2400),
  });
  assert.equal(deity3.data.color, 0xff0000);

  const king = buildStatsEmbed({
    civVersion: 'civ6',
    mode: 'realtime',
    targetMention: '<@1>',
    lifetime: set(1500),
    season: set(1500),
  });
  assert.equal(king.data.color, 0x00c0ff);
});

test('buildStatsEmbed falls back to the default colour when there is no FFA rating', () => {
  const embed = buildStatsEmbed({
    civVersion: 'civ6',
    mode: 'realtime',
    targetMention: '<@1>',
    lifetime: set(null),
    season: set(null),
  });

  assert.equal(embed.data.color, 0x9d7cc4);
});
