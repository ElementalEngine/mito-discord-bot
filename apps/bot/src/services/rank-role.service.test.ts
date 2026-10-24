import assert from 'node:assert/strict';
import test from 'node:test';

import type { Guild } from 'discord.js';

import { syncRankRoles } from './rank-role.service.js';

// A guild that fails on any use, so touching it at all is seen.
const broken = new Proxy(
  {},
  {
    get: () => {
      throw new Error('guild unavailable');
    },
  },
) as Guild;

test('rank roles are left alone when nobody moved, and a failure never reaches the caller', async () => {
  await syncRankRoles(broken, [], 'm1');
  await syncRankRoles(broken, null, 'm1');
  await assert.doesNotReject(syncRankRoles(broken, [{ discord_id: '1', rating_mu: 1200 }], 'm1'));
});
