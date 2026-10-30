import { test } from 'node:test';
import assert from 'node:assert/strict';

import { editionName, versionOf } from './edition.js';

test('a game as core-api names it reads as its edition', () => {
  assert.equal(versionOf('CIV7'), 'civ7');
  assert.equal(versionOf('civ6'), 'civ6');
  assert.equal(editionName('CIV6'), 'Civ6');
  assert.equal(editionName('civ7'), 'Civ7');
});
