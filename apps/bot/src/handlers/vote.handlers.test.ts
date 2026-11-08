import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Refusal } from '../ui/reply.js';

// The league server never answers the civ data read the form needs.
globalThis.fetch = (() => new Promise<Response>(() => undefined)) as typeof fetch;

test('the /vote bans form is refused inside the 3 second window when the civ data is slow', async () => {
  const { openBansForm } = await import('./vote.handlers.js');
  let shown = false;
  const interaction = { id: '9', createdTimestamp: Date.now() - 2_000, showModal: async () => void (shown = true) };
  const request = { edition: 'civ6', mode: 'ffa', age: null, guild_id: '1', channel_id: '2', players: ['1', '2'], leader_bans: [], civ_bans: [] };
  await assert.rejects(openBansForm(interaction as never, request as never), Refusal);
  assert.equal(shown, false);
});
