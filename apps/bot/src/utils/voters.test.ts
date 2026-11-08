import { test } from 'node:test';
import assert from 'node:assert/strict';

import { idsIn } from './voters.js';

test('players are mentions or bare ids, each once; a role or channel mention is none', () => {
  const [user, other, role, channel] = ['111111111111111111', '444444444444444444', '222222222222222222', '333333333333333333'];
  assert.deepEqual(idsIn(`<@${user}> <@&${role}> <#${channel}> ${other} <@!${user}>`), [user, other]);
});
