import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseDiscordUserId } from '../../../src/features/reporting/parse-discord-id.js';

test('parseDiscordUserId: raw snowflake passes through', () => {
  assert.equal(parseDiscordUserId('123456789012345678'), '123456789012345678');
});

test('parseDiscordUserId: <@id> and <@!id> mentions parsed', () => {
  assert.equal(parseDiscordUserId('<@123456789012345678>'), '123456789012345678');
  assert.equal(parseDiscordUserId('<@!123456789012345678>'), '123456789012345678');
});

test('parseDiscordUserId: junk and empty return null', () => {
  assert.equal(parseDiscordUserId('nope'), null);
  assert.equal(parseDiscordUserId(''), null);
  assert.equal(parseDiscordUserId(null), null);
  assert.equal(parseDiscordUserId('123'), null); // too short for a snowflake
});
