import { test } from 'node:test';
import assert from 'node:assert/strict';

import { lfgRoleFor } from './lobby.service.js';

test('teamers ping the teamer LFG role; FFAs and duels the FFA one', () => {
  const roles = { civ6LfgFfa: 'ffa-role', civ6LfgTeamer: 'teamer-role' };
  for (const shape of ['ffa-8', 'ffa-14', 'duel'] as const) assert.equal(lfgRoleFor(shape, roles), 'ffa-role');
  for (const shape of ['teamer-2v2', 'teamer-5v5', 'teamer-2v2v2v2'] as const) assert.equal(lfgRoleFor(shape, roles), 'teamer-role');
  assert.equal(lfgRoleFor('teamer-3v3', { civ6LfgFfa: 'ffa-role', civ6LfgTeamer: '' }), '');
});
