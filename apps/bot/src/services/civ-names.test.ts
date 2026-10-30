import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';

import type { Client } from 'discord.js';

import type { ApiClient } from '../api/index.js';
import type { CivDataResponse } from '../api/types.js';
import { checkPortraits, civNames, forgetCivNames, loadAppEmojis } from './civ-names.js';

const data = {
  edition: 'civ6',
  leader_data_version: 3,
  leaders: [{ token: 'LEADER_SHAKA', name: 'Shaka', display: 'Shaka' }],
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

test('portraits come from the bot emoji by name, and refresh cached names', async () => {
  const { api } = fakeApi();
  assert.equal((await civNames('civ6', api, 0)).get('LEADER_SHAKA'), 'Shaka');
  const client = {
    application: { emojis: { fetch: async () => new Map([['9', { id: '9', name: 'Shaka' }]]) } },
  } as unknown as Client;
  await loadAppEmojis(client);
  assert.equal((await civNames('civ6', api, 1)).get('LEADER_SHAKA'), '<:Shaka:9> Shaka');
});

test('startup names each leader and civ the bot has no emoji for', async () => {
  const client = { application: { emojis: { fetch: async () => new Map([['9', { id: '9', name: 'Shaka' }]]) } } } as unknown as Client;
  await loadAppEmojis(client);
  const civ7 = { ...data, edition: 'civ7', leaders: [{ token: 'LEADER_AUGUSTUS', name: 'Augustus' }], civs: [{ token: 'CIVILIZATION_ROME', name: 'Roman' }] };
  const api = { getCivData: async (edition: string) => (edition === 'civ7' ? civ7 : data) } as unknown as ApiClient;
  assert.deepEqual(await checkPortraits(api), ['Augustus', 'Roman']);
});
