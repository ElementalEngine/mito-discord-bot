import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { ChatInputCommandInteraction } from 'discord.js';

const RANKED = '100000000000000001';
const DEVELOPER = '100000000000000002';
const CIV7 = '100000000000000003';
const COMMANDS = '200000000000000001';
const LOBBY_LINKS = '200000000000000002';
process.env.ROLE_CIV6_RANKED = RANKED;
process.env.ROLE_CIV7_RANKED = CIV7;
process.env.ROLE_DEVELOPER = DEVELOPER;
process.env.CHANNEL_BOT_COMMANDS_ID = COMMANDS;
process.env.CHANNEL_CIV6_LOBBY_LINKS_ID = LOBBY_LINKS;
const { ensureCommandAccess } = await import('./ensure-command-access.js');

function asked(command: string, roles: string[], channelId: string, parentId: string | null = null) {
  const [commandName, subcommand = null] = command.split(' ');
  const replies: string[] = [];
  const interaction = {
    commandName,
    options: { getSubcommand: () => subcommand },
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

test("a subcommand's channels replace the row's", async () => {
  assert.equal(await ensureCommandAccess(asked('lobby host', [RANKED], LOBBY_LINKS).interaction), true);
  assert.equal(await ensureCommandAccess(asked('lobby host', [RANKED], '300000000000000001').interaction), false);
});

test("a game's subcommand takes that game's rank role, and holding both passes either", async () => {
  assert.equal(await ensureCommandAccess(asked('vote civ7', [RANKED], COMMANDS).interaction), false);
  assert.equal(await ensureCommandAccess(asked('vote civ6', [CIV7], COMMANDS).interaction), false);
  assert.equal(await ensureCommandAccess(asked('draft civ7', [CIV7], COMMANDS).interaction), true);
  assert.equal(await ensureCommandAccess(asked('draft civ6', [RANKED, CIV7], COMMANDS).interaction), true);
  assert.equal(await ensureCommandAccess(asked('draft civ7', [RANKED, CIV7], COMMANDS).interaction), true);
  assert.equal(await ensureCommandAccess(asked('lobby host', [CIV7], LOBBY_LINKS).interaction), false);
  assert.equal(await ensureCommandAccess(asked('vote civ7', [DEVELOPER], COMMANDS).interaction), true);
});

test('a command with no row fails rather than opening', async () => {
  const { interaction, replies } = asked('nothing', [RANKED], COMMANDS);
  assert.equal(await ensureCommandAccess(interaction), false);
  assert.ok(replies[0].includes('not configured'));
});
