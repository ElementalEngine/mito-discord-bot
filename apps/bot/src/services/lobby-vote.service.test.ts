import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { CivDataResponse, Lobby } from '../api/types.js';
import { ballotOf } from './lobby-vote.service.js';

const lobby = { players: ['100', '200', '300'].map((discord_id) => ({ discord_id, team: null })) } as unknown as Lobby;
const DATA = { leaders: [{ token: 'LEADER_GANDHI', name: 'Gandhi' }, { token: 'LEADER_TRAJAN', name: 'Trajan' }], civs: [] } as unknown as CivDataResponse;

test('ban reactions become a ballot of players only, by leader portrait name', () => {
  const ballot = ballotOf(
    [
      { id: '1', name: 'Gandhi', users: ['100', '200', 'watcher'] },
      { id: '2', name: 'Gandhi', users: ['200', '300'] },
      { id: null, name: 'Trajan', users: ['100'] },
      { id: '3', name: 'Nobody', users: ['100'] },
      { id: '4', name: 'Trajan', users: ['watcher'] },
    ],
    lobby,
    DATA,
  );
  assert.deepEqual(ballot, { bans: { LEADER_GANDHI: ['100', '200', '300'] } });
});
