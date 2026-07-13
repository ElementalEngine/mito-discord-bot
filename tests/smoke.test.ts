import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ENGINE_SCAFFOLD } from '../src/engine/index.js';
import { SESSION_SCAFFOLD } from '../src/session/index.js';
import { ACTIVITY_SCAFFOLD } from '../src/activity/index.js';

test('node:test runs TypeScript via tsx and resolves src imports', () => {
  assert.equal(ENGINE_SCAFFOLD, true);
  assert.equal(SESSION_SCAFFOLD, true);
  assert.equal(ACTIVITY_SCAFFOLD, true);
});