import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { ApplicationCommandPermissionType as Type } from 'discord.js';

import type { Command } from '../types/global.js';
import { payloadOf } from '../deploy.js';
import { COMMAND_ACCESS, driftOf, type Wanted } from './command-access.js';

/**
 * Discord's Integrations settings are set by hand from this table, and startup
 * compares the two. What should break this file: a command missing from the
 * table, a staff command deployed visible, or a difference the check misses.
 */

const GUILD = '1000';
const ALL_CHANNELS = '999';

async function commands(): Promise<Map<string, Command>> {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'commands');
  const found = new Map<string, Command>();
  for (const dir of await readdir(root, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    for (const file of await readdir(path.join(root, dir.name))) {
      if (!file.endsWith('.ts') || file.endsWith('.test.ts')) continue;
      const mod = (await import(pathToFileURL(path.join(root, dir.name, file)).href)) as Command;
      found.set(mod.data.name, mod);
    }
  }
  return found;
}

test('every command has one row in the table, and every row a command', async () => {
  assert.deepEqual([...(await commands()).keys()].sort(), Object.keys(COMMAND_ACCESS).sort());
});

test('every command needs a role: unverified members see none of them', () => {
  assert.deepEqual(Object.entries(COMMAND_ACCESS).filter(([, a]) => !a.roles?.length).map(([name]) => name), []);
});

test('staff commands deploy hidden; the rest keep their own defaults', async () => {
  const hidden = payloadOf(await commands())
    .filter((c) => c.default_member_permissions === '0')
    .map((c) => c.name)
    .sort();
  assert.deepEqual(hidden, ['get-users', 'report-revert', 'resetstats', 'season-new']);
});

const role = (id: string, permission = true) => ({ id, type: Type.Role, permission });
const channel = (id: string, permission = true) => ({ id, type: Type.Channel, permission });
const want = (over: Partial<Wanted>): Wanted => ({ roles: null, channels: null, staffOnly: false, ...over });

test('a command with no overrides differs only where the table restricts it', () => {
  assert.deepEqual(driftOf(want({}), [], GUILD), []);
  assert.deepEqual(driftOf(want({ channels: ['1', '2'] }), [], GUILD), [
    { kind: 'channels', want: ['1', '2'], have: null },
  ]);
});

test('overrides that match the table are clean', () => {
  const have = [role(GUILD, false), role('7'), role('8'), channel(ALL_CHANNELS, false), channel('2'), channel('1')];
  assert.deepEqual(driftOf(want({ roles: ['7', '8'], channels: ['1', '2'] }), have, GUILD), []);
});

test('a staff command is closed by its default, so only its roles need granting', () => {
  assert.deepEqual(driftOf(want({ roles: ['7'], staffOnly: true }), [role('7')], GUILD), []);
  assert.deepEqual(driftOf(want({ roles: ['7'], staffOnly: true }), [], GUILD), [
    { kind: 'roles', want: ['7'], have: [] },
  ]);
});

test('a missing role, an extra channel, a single denial and a user override are each named', () => {
  const have = [
    role(GUILD, false),
    role('7'),
    channel(ALL_CHANNELS, false),
    channel('1'),
    channel('3'),
    { id: '55', type: Type.User, permission: true },
  ];
  assert.deepEqual(driftOf(want({ roles: ['7', '8'], channels: ['1'] }), have, GUILD), [
    { kind: 'roles', want: ['7', '8'], have: ['7'] },
    { kind: 'channels', want: ['1'], have: ['1', '3'] },
    { kind: 'users', want: null, have: ['55'] },
  ]);
  assert.deepEqual(driftOf(want({}), [channel('4', false)], GUILD), [
    { kind: 'channels', want: null, have: ['!4'] },
  ]);
});
