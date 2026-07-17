import { test } from 'node:test';
import assert from 'node:assert/strict';

import { humanizeGameId } from '../../src/shared/text.js';

test('humanizeGameId title-cases lowercase and camelCase tokens', () => {
  assert.equal(humanizeGameId('leader_abraham_lincoln'), 'Leader Abraham Lincoln');
  assert.equal(humanizeGameId('civilizationRomeAlt'), 'Civilization Rome Alt');
});

test('humanizeGameId leaves ALL-CAPS tokens alone (ALL_CAPS_RE guard)', () => {
  assert.equal(humanizeGameId('LEADER_ABRAHAM_LINCOLN'), 'LEADER ABRAHAM LINCOLN');
  assert.equal(humanizeGameId('CIV VI'), 'CIV VI');
});

test('humanizeGameId returns the original when nothing survives normalization', () => {
  assert.equal(humanizeGameId('___'), '___');
  assert.equal(humanizeGameId(''), '');
});