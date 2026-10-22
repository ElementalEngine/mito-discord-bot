import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';

import type { ApiClient } from '../api/index.js';
import type { CivDataResponse } from '../api/types.js';
import { civNames, editionOf, forgetCivNames } from './civ-names.js';

/**
 * Display names, cached per edition. What should break this file: a fetch
 * on every panel, or a core-api outage taking the panel down with it.
 */

const data = {
  edition: 'civ6',
  leader_data_version: 3,
  leaders: [{ token: 'LEADER_SHAKA', name: 'Shaka', display: 'Shaka', emoji_id: null }],
  civs: [],
} as unknown as CivDataResponse;

function fakeApi(fail = false): { api: ApiClient; calls: () => number } {
  let n = 0;
  const api = {
    getCivData: async () => {
      n += 1;
      if (fail) throw new Error('down');
      return data;
    },
  } as unknown as ApiClient;
  return { api, calls: () => n };
}

afterEach(() => forgetCivNames());

test('names are fetched once and reused for ten minutes', async () => {
  const { api, calls } = fakeApi();
  await civNames('civ6', api, 0);
  const again = await civNames('civ6', api, 9 * 60_000);
  assert.equal(calls(), 1);
  assert.equal(again.get('LEADER_SHAKA'), 'Shaka');
  await civNames('civ6', api, 11 * 60_000);
  assert.equal(calls(), 2);
});

test('an outage keeps the last good names, or none, and never throws', async () => {
  const good = fakeApi();
  await civNames('civ6', good.api, 0);
  const stale = await civNames('civ6', fakeApi(true).api, 20 * 60_000);
  assert.equal(stale.get('LEADER_SHAKA'), 'Shaka');
  forgetCivNames();
  assert.equal((await civNames('civ7', fakeApi(true).api, 0)).size, 0);
});

test('the edition comes from the match game', () => {
  assert.equal(editionOf('CIV7'), 'civ7');
  assert.equal(editionOf('civ6'), 'civ6');
});
