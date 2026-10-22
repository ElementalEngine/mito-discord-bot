import { test } from 'node:test';
import assert from 'node:assert/strict';

import { holdsAny } from './access.js';

/**
 * Staff is a fact Mite asserts to core-api, so a wrong answer grants an
 * approve or a tie. What should break this file: an unset role id (an empty
 * env value) matching anyone.
 */

test('a held role matches', () => {
  assert.equal(holdsAny(new Set(['111', '222']), ['333', '222']), true);
});

test('no shared role does not match', () => {
  assert.equal(holdsAny(new Set(['111']), ['222']), false);
});

test('an unset role id never matches, even against an empty one', () => {
  assert.equal(holdsAny(new Set(['']), ['', '  ']), false);
  assert.equal(holdsAny(new Set(['111']), []), false);
});
