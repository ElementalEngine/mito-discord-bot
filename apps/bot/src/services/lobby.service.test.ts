import { test } from 'node:test';
import assert from 'node:assert/strict';

import { lfgRoleFor } from './lobby.service.js';

test('each mode pings its own LFG role: duels the duel one, teamers the teamer one, FFAs the FFA one', () => {
  const roles = { civ6LfgFfa: 'ffa-role', civ6LfgDuel: 'duel-role', civ6LfgTeamer: 'teamer-role' };
  for (const shape of ['ffa-8', 'ffa-14'] as const) assert.equal(lfgRoleFor(shape, roles), 'ffa-role');
  assert.equal(lfgRoleFor('duel', roles), 'duel-role');
  for (const shape of ['teamer-2v2', 'teamer-5v5', 'teamer-2v2v2v2'] as const) assert.equal(lfgRoleFor(shape, roles), 'teamer-role');
  assert.equal(lfgRoleFor('teamer-3v3', { ...roles, civ6LfgTeamer: '' }), '');
  assert.equal(lfgRoleFor('duel', { ...roles, civ6LfgDuel: '' }), '');
});
