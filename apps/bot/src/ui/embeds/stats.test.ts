import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fmtRow } from './stats.js';
import type { StatRow } from '../../api/types.js';

/**
 * fmtRow printed Skill and TS Mu from the same field, and Wins and 1st
 * from two fields that are the same number in duel and teamer.
 *
 * What should break this file: labelling the rating-gain counter a win,
 * or printing one value under two labels again.
 */

const row = (games: number, wins: number, first: number): StatRow =>
  ({
    mu: 1250,
    sigma: 8.4,
    games,
    wins,
    first,
    subbedIn: 0,
    subbedOut: 0,
  }) as unknown as StatRow;

test('a duel row shows wins and losses, not a duplicated count', () => {
  const out = fmtRow(row(10, 5, 7), true);
  assert.match(out, /Wins: 7/);
  assert.match(out, /Losses: 3/);
  assert.doesNotMatch(out, /1st:/);
  assert.doesNotMatch(out, /Wins: 5/);
});

test('an ffa row keeps both counters and labels the gain honestly', () => {
  const out = fmtRow(row(60, 30, 10), false);
  assert.match(out, /1st: 10/);
  assert.match(out, /Rating gains: 30/);
  assert.doesNotMatch(out, /Wins:/);
});

test('skill is printed once, not twice under two labels', () => {
  const out = fmtRow(row(10, 5, 7), true);
  assert.equal(out.match(/1250/g)?.length, 1);
  assert.doesNotMatch(out, /TS Mu/);
});

test('losses never go negative', () => {
  assert.match(fmtRow(row(3, 0, 5), true), /Losses: 0/);
});

test('a missing row is still a dash', () => {
  assert.equal(fmtRow(null, true), '—');
  assert.equal(fmtRow(undefined, false), '—');
});
