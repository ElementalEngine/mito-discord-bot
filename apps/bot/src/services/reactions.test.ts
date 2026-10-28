import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { SendableChannels } from 'discord.js';

import { ballotOf, reactionsOn } from './reactions.js';

const PLAYERS = ['100', '200', '300'];
const LEADERS = [
  { token: 'LEADER_GANDHI', name: 'IndiaGandhi', display: 'Gandhi', civ_display: 'India' },
  { token: 'LEADER_TRAJAN', name: 'RomeTrajan', display: 'Trajan', civ_display: 'Rome' },
  { token: 'LEADER_CATHERINE_A', name: 'FranceCatherineA', display: 'Catherine', civ_display: 'France' },
  { token: 'LEADER_CATHERINE_B', name: 'FranceCatherineB', display: 'Catherine', civ_display: 'France' },
];

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
    PLAYERS,
    LEADERS,
  );
  assert.deepEqual(ballot, { bans: { LEADER_GANDHI: ['100', '200', '300'], LEADER_TRAJAN: ['100'] } });
  assert.deepEqual(unmatched, ['Catherine', 'Nobody']);
});

test('civ bans match a civ emoji by its name or display', () => {
  const civs = [{ token: 'CIVILIZATION_ROME', name: 'CivRome', display: 'Rome' }];
  const { ballot } = ballotOf([{ id: '7', name: 'rome', users: ['100'] }], PLAYERS, civs);
  assert.deepEqual(ballot, { bans: { CIVILIZATION_ROME: ['100'] } });
});

test('a message is read fresh from Discord, and an emoji only the bot added is not read further', async () => {
  let reads = 0;
  const reaction = (id: string, count: number) => ({
    emoji: { id, name: `E${id}` },
    count,
    me: true,
    users: { fetch: async () => (reads++, new Map([['bot', {}], ['100', {}]])) },
  });
  const place = {
    messages: {
      fetch: async (o: { message: string; force?: boolean }) => ({ reactions: { cache: new Map(o.force ? [['9', reaction('9', 2)], ['8', reaction('8', 1)]] : []) } }),
    },
  } as unknown as SendableChannels;
  assert.deepEqual(await reactionsOn(place, 'm1'), [
    { id: '9', name: 'E9', users: ['bot', '100'] },
    { id: '8', name: 'E8', users: [] },
  ]);
  assert.equal(reads, 1);
});
