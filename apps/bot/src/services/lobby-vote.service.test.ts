import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { CivDataResponse, Lobby, SettingQuestion } from '../api/types.js';
import { ballotOf } from './lobby-vote.service.js';

const lobby = { players: ['100', '200', '300'].map((discord_id) => ({ discord_id, team: null })) } as unknown as Lobby;
const QUESTIONS = [
  { id: 'map', options: [{ id: 'pangea', emoji: '🌐' }, { id: 'lakes', emoji: '🌊' }] },
  { id: 'friends', options: [{ id: 'inf', emoji: '♾️' }] },
] as unknown as SettingQuestion[];
const DATA = { leaders: [{ token: 'LEADER_GANDHI', name: 'Gandhi' }, { token: 'LEADER_TRAJAN', name: 'Trajan' }], civs: [] } as unknown as CivDataResponse;

test('reactions become a ballot of players only, by option and by leader portrait', () => {
  const ballot = ballotOf(
    [
      {
        key: 'map',
        reactions: [
          { id: null, name: '🌐', users: ['100', '200', 'bot', 'watcher'] },
          { id: null, name: '🌊', users: ['bot'] },
          { id: null, name: '🦖', users: ['300'] },
          { id: '55', name: 'lakes', users: ['300'] },
        ],
      },
      { key: 'friends', reactions: [{ id: null, name: '♾', users: ['300'] }] },
      {
        key: 'bans',
        reactions: [
          { id: '1', name: 'Gandhi', users: ['100', '200'] },
          { id: '2', name: 'Gandhi', users: ['200', '300'] },
          { id: null, name: 'Trajan', users: ['100'] },
          { id: '3', name: 'Nobody', users: ['100'] },
        ],
      },
      { key: 'retired', reactions: [{ id: null, name: '🌐', users: ['100'] }] },
    ],
    lobby,
    QUESTIONS,
    DATA,
  );
  assert.deepEqual(ballot, {
    settings: { map: { pangea: ['100', '200'] }, friends: { inf: ['300'] } },
    bans: { LEADER_GANDHI: ['100', '200', '300'] },
  });
});
