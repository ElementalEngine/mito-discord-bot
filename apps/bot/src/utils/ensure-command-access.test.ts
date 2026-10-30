import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { ChatInputCommandInteraction } from 'discord.js';

const RANKED = '100000000000000001';
const DEVELOPER = '100000000000000002';
const COMMANDS = '200000000000000001';
const LOBBY_LINKS = '200000000000000002';
process.env.ROLE_CIV6_RANKED = RANKED;
process.env.ROLE_DEVELOPER = DEVELOPER;
process.env.CHANNEL_BOT_COMMANDS_ID = COMMANDS;
process.env.CHANNEL_CIV6_LOBBY_LINKS_ID = LOBBY_LINKS;
const { ensureCommandAccess } = await import('./ensure-command-access.js');

function asked(commandName: string, roles: string[], channelId: string, parentId: string | null = null) {
  const replies: string[] = [];
  const interaction = {
    commandName,
    inGuild: () => true,
    inCachedGuild: () => true,
    channel: parentId ? { isThread: () => true, parentId } : { isThread: () => false },
    channelId,
    member: { roles: { cache: new Map(roles.map((id) => [id, {}])) } },
    deferred: false,
    replied: false,
    reply: async (body: unknown) => {
      replies.push(JSON.stringify(body));
    },
  } as unknown as ChatInputCommandInteraction;
  return { interaction, replies };
}

test('a ranked player passes in a commands channel, and in a thread under it', async () => {
  assert.equal(await ensureCommandAccess(asked('stats', [RANKED], COMMANDS).interaction), true);
  assert.equal(await ensureCommandAccess(asked('stats', [RANKED], '300000000000000001', COMMANDS).interaction), true);
});

test('a role outside the row is refused, and the reply names the roles that pass', async () => {
  const { interaction, replies } = asked('stats', ['100000000000000009'], COMMANDS);
  assert.equal(await ensureCommandAccess(interaction), false);
  assert.equal(replies.length, 1);
  assert.ok(replies[0].includes(RANKED) && replies[0].includes(DEVELOPER));
});

test('a staff command keeps to its own roles', async () => {
  assert.equal(await ensureCommandAccess(asked('season-new', [DEVELOPER], COMMANDS).interaction), true);
  assert.equal(await ensureCommandAccess(asked('season-new', [RANKED], COMMANDS).interaction), false);
});

test("outside the row's channels the reply points to them", async () => {
  const { interaction, replies } = asked('stats', [RANKED], LOBBY_LINKS);
  assert.equal(await ensureCommandAccess(interaction), false);
  assert.ok(replies[0].includes(`<#${COMMANDS}>`));
});

test("a command that picks its channels by edition checks those instead of the row's", async () => {
  assert.equal(await ensureCommandAccess(asked('lobby', [RANKED], LOBBY_LINKS).interaction, [LOBBY_LINKS]), true);
  assert.equal(await ensureCommandAccess(asked('lobby', [RANKED], COMMANDS).interaction, [LOBBY_LINKS]), false);
});

test('a command with no row fails rather than opening', async () => {
  const { interaction, replies } = asked('nothing', [RANKED], COMMANDS);
  assert.equal(await ensureCommandAccess(interaction), false);
  assert.ok(replies[0].includes('not configured'));
});
