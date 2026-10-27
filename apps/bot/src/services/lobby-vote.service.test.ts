import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { SendableChannels } from 'discord.js';

import type { CivDataResponse, Lobby } from '../api/types.js';
import { ballotOf, banReactions } from './lobby-vote.service.js';

const lobby = { players: ['100', '200', '300'].map((discord_id) => ({ discord_id, team: null })) } as unknown as Lobby;
const DATA = {
  leaders: [
    { token: 'LEADER_GANDHI', name: 'IndiaGandhi', display: 'Gandhi', civ_display: 'India' },
    { token: 'LEADER_TRAJAN', name: 'RomeTrajan', display: 'Trajan', civ_display: 'Rome' },
    { token: 'LEADER_CATHERINE_A', name: 'FranceCatherineA', display: 'Catherine', civ_display: 'France' },
    { token: 'LEADER_CATHERINE_B', name: 'FranceCatherineB', display: 'Catherine', civ_display: 'France' },
  ],
  civs: [],
} as unknown as CivDataResponse;

test('ban reactions become a ballot of players only, matched by the emoji name in any common form', () => {
  const { ballot, unmatched } = ballotOf(
    [
      { id: '1', name: 'IndiaGandhi', users: ['100', '200', 'watcher'] },
      { id: '2', name: 'gandhi', users: ['200', '300'] },
      { id: '3', name: 'Trajan_Rome', users: ['100'] },
      { id: null, name: 'Trajan', users: ['200'] },
      { id: '4', name: 'Catherine', users: ['100'] },
      { id: '5', name: 'Nobody', users: ['100'] },
    ],
    lobby,
    DATA,
  );
  assert.deepEqual(ballot, { bans: { LEADER_GANDHI: ['100', '200', '300'], LEADER_TRAJAN: ['100'] } });
  assert.deepEqual(unmatched, ['Catherine', 'Nobody']);
});

test('the vote message is read fresh from Discord, since its cached copy never has reactions', async () => {
  const reaction = { emoji: { id: '9', name: 'IndiaGandhi' }, users: { fetch: async () => new Map([['100', {}], ['200', {}]]) } };
  const place = {
    messages: {
      fetch: async (o: { message: string; force?: boolean }) => ({ reactions: { cache: new Map(o.force ? [['9', reaction]] : []) } }),
    },
  } as unknown as SendableChannels;
  assert.deepEqual(await banReactions(place, 'm1'), [{ id: '9', name: 'IndiaGandhi', users: ['100', '200'] }]);
});
