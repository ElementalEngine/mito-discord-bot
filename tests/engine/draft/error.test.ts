import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DraftError, inputError, isDraftInputError } from '../../../src/engine/draft/errors.js';

test('DraftError: code + name preserved (legacy parity shape)', () => {
  const err = new DraftError('NO_POOL', 'nope');
  assert.equal(err.code, 'NO_POOL');
  assert.equal(err.name, 'DraftError');
  assert.equal(err.message, 'nope');
  assert.ok(err instanceof Error);
});

test('inputError / isDraftInputError', () => {
  const err = inputError('STALE', 'stale');
  assert.deepEqual(err, { error: { code: 'STALE', message: 'stale' } });
  assert.equal(isDraftInputError(err), true);
  assert.equal(isDraftInputError(null), false);
  assert.equal(isDraftInputError('x'), false);
  assert.equal(isDraftInputError({ state: {} }), false);
});
