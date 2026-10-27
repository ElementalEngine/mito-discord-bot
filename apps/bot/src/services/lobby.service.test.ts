import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { Client } from 'discord.js';

import type { ApiClient } from '../api/index.js';
import type { Lobby } from '../api/types.js';
import { publishLobby, showLobby } from './lobby.service.js';

const setup: Lobby = {
  id: '652f1a2b3c4d5e6f7a8b9c0d',
  code: 'K7Q2DM',
  shape: 'ffa-8',
  mode: 'ffa',
  seats: 8,
  teams: 0,
  draft_mode: 'standard',
  status: 'open',
  phase: 'setup',
  deadline: null,
  host_id: '100',
  guild_id: '1',
  channel_id: '2',
  message_id: null,
  steam_link: null,
  players: [{ discord_id: '100', team: null }],
  settings: [],
  bans: [],
  pools: [],
  picks: [],
  vote: null,
  cancel_reason: null,
  updated_at: '2026-10-27T12:00:00Z',
};
const api = {
  getCivData: async () => ({ leaders: [], civs: [] }),
  lobbySettings: async () => [],
  openLobby: async (_id: string, _host: unknown, messageId: string) => ({ ...setup, phase: 'live', message_id: messageId }),
} as unknown as ApiClient;

function fakeChannel() {
  const sent: string[] = [];
  const deleted: string[] = [];
  const channel = {
    isTextBased: () => true,
    isSendable: () => true,
    send: async (o: { components: { toJSON(): unknown }[] }) => {
      sent.push(JSON.stringify(o.components[0]!.toJSON()));
      return { id: '3', delete: async () => undefined };
    },
    messages: { edit: async () => ({}), delete: async (id: string) => void deleted.push(id) },
  };
  return { client: { channels: { fetch: async () => channel } } as unknown as Client, sent, deleted };
}

test('a confirmed lobby is posted live, with its seats and buttons', async () => {
  const { client, sent } = fakeChannel();
  assert.equal((await publishLobby(client, setup, { id: '100' }, api)).phase, 'live');
  assert.match(sent[0]!, /\*\*Seats\*\*/);
  for (const verb of ['join', 'leave', 'start', 'edit']) assert.match(sent[0]!, new RegExp(`"lobby:${verb}:${setup.id}"`));
});

test('a cancelled lobby has its post removed', async () => {
  const { client, deleted } = fakeChannel();
  await showLobby(client, { ...setup, phase: 'live', message_id: '3', status: 'cancelled', cancel_reason: 'host' }, api);
  assert.deepEqual(deleted, ['3']);
});
