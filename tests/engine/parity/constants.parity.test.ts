import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CWC_PICK_ORDER, DRAFT_TIMERS_MS } from '../../../src/config/draft.config.js';
import { ENGINE_CWC_PICK_ORDER, ENGINE_DRAFT_TIMERS_MS } from '../../../src/engine/draft/constants.js';

// Anti-drift gate: the engine owns copies of the legacy draft constants
// (the engine zone cannot import legacy config). If either side changes,
// this test fails and forces a deliberate decision.
test('engine draft constants equal legacy draft.config values', () => {
  assert.equal(ENGINE_DRAFT_TIMERS_MS.blind, DRAFT_TIMERS_MS.blind);
  assert.equal(ENGINE_DRAFT_TIMERS_MS.snakePick, DRAFT_TIMERS_MS.snakePick);
  assert.equal(ENGINE_DRAFT_TIMERS_MS.cwcCaptainSelect, DRAFT_TIMERS_MS.cwcCaptainSelect);
  assert.equal(ENGINE_DRAFT_TIMERS_MS.cwcPick, DRAFT_TIMERS_MS.cwcPick);
  assert.deepEqual([...ENGINE_CWC_PICK_ORDER], [...CWC_PICK_ORDER]);
});
