import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { ChatInputCommandInteraction } from 'discord.js';
import { memberHasRole } from '../../../src/features/reporting/access.js';

const asInteraction = (member: unknown): ChatInputCommandInteraction =>
  ({ member }) as unknown as ChatInputCommandInteraction;

test('memberHasRole: APIInteractionGuildMember (roles: string[])', () => {
  assert.equal(memberHasRole(asInteraction({ roles: ['r1', 'r2'] }), 'r2'), true);
  assert.equal(memberHasRole(asInteraction({ roles: ['r1'] }), 'r2'), false);
});

test('memberHasRole: gateway GuildMember (roles.cache)', () => {
  const member = { roles: { cache: new Map([['r3', {}]]) } };
  assert.equal(memberHasRole(asInteraction(member), 'r3'), true);
  assert.equal(memberHasRole(asInteraction(member), 'rX'), false);
});

test('memberHasRole: missing / non-object member is false', () => {
  assert.equal(memberHasRole(asInteraction(null), 'r1'), false);
  assert.equal(memberHasRole(asInteraction('nope'), 'r1'), false);
  assert.equal(memberHasRole(asInteraction({}), 'r1'), false);
});
