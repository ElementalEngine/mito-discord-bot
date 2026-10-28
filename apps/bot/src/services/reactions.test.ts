import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { SendableChannels } from 'discord.js';

import { ballotOf, distrustReactions, reactionsOn, trackReaction, unwatchReactions, watchReactions } from './reactions.js';

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

test('messages posted together are read in one go, any missing alone, and an emoji only the bot added is not read further', async () => {
  let reads = 0;
  const reaction = (id: string, count: number) => ({
    emoji: { id, name: `E${id}` },
    count,
    me: true,
    users: { fetch: async () => (reads++, new Map([['bot', {}], ['100', {}]])) },
  });
  const message = (...reactions: ReturnType<typeof reaction>[]) => ({ reactions: { cache: new Map(reactions.map((r) => [r.emoji.id, r])) } });
  const asked: unknown[] = [];
  const place = {
    messages: {
      fetch: async (o: { after?: string; message?: string; force?: boolean }) => {
        asked.push(o);
        return o.after ? new Map([['11', message(reaction('9', 2), reaction('8', 1))]]) : message(reaction('7', 3));
      },
    },
  } as unknown as SendableChannels;
  const read = await reactionsOn(place, ['12', undefined, '11']);
  assert.deepEqual(asked, [{ after: '10', limit: 100 }, { message: '12', force: true }]);
  assert.deepEqual(Object.fromEntries(read), {
    '12': [{ id: '7', name: 'E7', users: ['bot', '100'] }],
    '11': [
      { id: '9', name: 'E9', users: ['bot', '100'] },
      { id: '8', name: 'E8', users: [] },
    ],
  });
  assert.equal(reads, 2);
});

test('a watched message is counted from what came in, unless a new session may have missed some', async () => {
  let reads = 0;
  const place = {
    messages: {
      cache: new Map([['21', {}]]),
      fetch: async () => (reads++, { reactions: { cache: new Map() } }),
    },
  } as unknown as SendableChannels;
  watchReactions('S1', '21', async () => undefined);
  trackReaction('21', { id: null, name: '1️⃣' }, '100', true);
  trackReaction('21', { id: null, name: '1️⃣' }, '200', true);
  trackReaction('21', { id: null, name: '1️⃣' }, '200', false);
  trackReaction('other', { id: null, name: '1️⃣' }, '300', true);
  assert.deepEqual(Object.fromEntries(await reactionsOn(place, ['21'])), { '21': [{ id: null, name: '1️⃣', users: ['100'] }] });
  assert.equal(reads, 0);
  distrustReactions();
  assert.deepEqual(Object.fromEntries(await reactionsOn(place, ['21'])), { '21': [] });
  assert.equal(reads, 1);
  unwatchReactions(['21']);
});
