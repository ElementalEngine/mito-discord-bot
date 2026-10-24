import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { ChatInputCommandInteraction } from 'discord.js';

const MOD = '100000000000000001';
const DEV = '100000000000000002';
const NOVICE = '100000000000000003';
const CHANNEL = '200000000000000001';
process.env.ROLE_MODERATOR = MOD;
process.env.ROLE_DEVELOPER = DEV;
const { ensureCommandAccess } = await import('./ensure-command-access.js');

function asked(roles: string[]) {
  const replies: string[] = [];
  const interaction = {
    inGuild: () => true,
    inCachedGuild: () => true,
    channel: null,
    channelId: CHANNEL,
    member: { roles: { cache: new Map(roles.map((id) => [id, {}])) } },
    deferred: false,
    replied: false,
    reply: async (body: unknown) => {
      replies.push(JSON.stringify(body));
    },
  } as unknown as ChatInputCommandInteraction;
  return { interaction, replies };
}

const policy = { allowedChannelIds: [CHANNEL], requiredRoleIds: [NOVICE], allowDeveloperOverride: true };

test('a moderator passes a command that keeps the default', async () => {
  const { interaction } = asked([MOD]);
  assert.equal(await ensureCommandAccess(interaction, policy), true);
});

test('a moderator is refused where the command opts out, and is not named as a way in', async () => {
  const { interaction, replies } = asked([MOD]);
  assert.equal(await ensureCommandAccess(interaction, { ...policy, allowModeratorOverride: false }), false);
  assert.equal(replies.length, 1);
  assert.ok(replies[0].includes(NOVICE) && replies[0].includes(DEV) && !replies[0].includes(MOD));
});

test('the required role and the developer still pass where moderators are refused', async () => {
  for (const role of [NOVICE, DEV]) {
    const { interaction } = asked([role]);
    assert.equal(await ensureCommandAccess(interaction, { ...policy, allowModeratorOverride: false }), true);
  }
});
