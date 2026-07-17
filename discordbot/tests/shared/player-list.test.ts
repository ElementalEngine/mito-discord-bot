import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normalizePlayerList } from '../../src/shared/player-list.js';

test('normalizePlayerList converts plain mentions to raw ids', () => {
  assert.equal(
    normalizePlayerList('<@123456789012345678> <@876543210987654321>'),
    '123456789012345678 876543210987654321'
  );
});

test('normalizePlayerList converts nickname mentions to raw ids (R3 fix)', () => {
  assert.equal(normalizePlayerList('<@!876543210987654321>'), '876543210987654321');
  assert.equal(
    normalizePlayerList('<@123456789012345678> <@!876543210987654321>'),
    '123456789012345678 876543210987654321'
  );
});

test('normalizePlayerList passes raw ids through and uppercases tie markers', () => {
  assert.equal(
    normalizePlayerList('123456789012345678 tie 876543210987654321'),
    '123456789012345678 TIE 876543210987654321'
  );
});

test('normalizePlayerList collapses arbitrary whitespace and bracket noise', () => {
  assert.equal(
    normalizePlayerList('  <@123456789012345678>\n\n  876543210987654321  '),
    '123456789012345678 876543210987654321'
  );
});

test('normalizePlayerList yields an empty string for blank input', () => {
  assert.equal(normalizePlayerList('   '), '');
});
