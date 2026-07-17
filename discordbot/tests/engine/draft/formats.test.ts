import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CIV6_LEADERS } from '../../../src/data/civ6.data.js';

import {
  assertDraftFormatAllowed,
  DRAFT_FORMATS,
  getDraftFormat,
  isDraftFormatAllowed,
  keysToColonTokens,
} from '../../../src/engine/draft/formats.js';
import type { DraftFormatId } from '../../../src/engine/draft/formats.js';
import type { DraftGameType } from '../../../src/shared/draft.types.js';

const GAME_TYPES: readonly DraftGameType[] = ['FFA', 'Teamer', 'Duel'];

test('keysToColonTokens: frozen legacy semantics (gameId tokens, unknown keys dropped, empty -> undefined)', () => {
  const keys = Object.keys(CIV6_LEADERS).slice(0, 2);
  const expected = keys.map((key) => `:${CIV6_LEADERS[key as keyof typeof CIV6_LEADERS].gameId}:`).join('\n');
  assert.equal(keysToColonTokens(keys, CIV6_LEADERS), expected);
  assert.equal(keysToColonTokens([], CIV6_LEADERS), undefined);
  assert.equal(keysToColonTokens(['NOT_A_KEY'], CIV6_LEADERS), undefined);
  assert.equal(
    keysToColonTokens(['NOT_A_KEY', keys[0] as string], CIV6_LEADERS),
    `:${CIV6_LEADERS[keys[0] as keyof typeof CIV6_LEADERS].gameId}:`,
  );
});

test('DRAFT_FORMATS: four formats, instant/interactive split, no random (D14)', () => {
  assert.deepEqual(DRAFT_FORMATS.map((format) => format.id), ['standard', 'blind', 'snake', 'cwc']);
  assert.deepEqual(
    DRAFT_FORMATS.map((format) => format.kind),
    ['instant', 'interactive', 'interactive', 'interactive'],
  );
  assert.ok(
    !DRAFT_FORMATS.some((format) => (format.id as string) === 'random'),
    'random is gone from the engine',
  );
});

test('game-type legality matrix (D15): cwc is Teamer-only; snake and blind are FFA/Duel-only', () => {
  const expected: Record<DraftFormatId, readonly DraftGameType[]> = {
    standard: ['FFA', 'Teamer', 'Duel'],
    blind: ['FFA', 'Duel'],
    snake: ['FFA', 'Duel'],
    cwc: ['Teamer'],
  };

  for (const format of DRAFT_FORMATS) {
    assert.deepEqual([...format.gameTypes], [...expected[format.id]], format.id);
    for (const gameType of GAME_TYPES) {
      assert.equal(
        isDraftFormatAllowed(format.id, gameType),
        expected[format.id].includes(gameType),
        `${format.id} x ${gameType}`,
      );
    }
  }

  for (const gameType of GAME_TYPES) {
    assert.ok(DRAFT_FORMATS.some((format) => format.gameTypes.includes(gameType)), gameType);
  }
});

test('assertDraftFormatAllowed: throws the legacy notice for every illegal pairing', () => {
  const messages: Record<DraftFormatId, string> = {
    standard: 'Standard draft is not available for this game type.',
    blind: 'Blind draft is only available for FFA or Duel votes.',
    snake: 'Snake draft is only available for FFA or Duel votes.',
    cwc: 'CWC is only available for Teamer votes.',
  };

  for (const format of DRAFT_FORMATS) {
    for (const gameType of GAME_TYPES) {
      if (format.gameTypes.includes(gameType)) {
        assert.doesNotThrow(() => assertDraftFormatAllowed(format.id, gameType));
        continue;
      }
      assert.throws(
        () => assertDraftFormatAllowed(format.id, gameType),
        { code: 'VALIDATION', message: messages[format.id] },
        `${format.id} x ${gameType}`,
      );
    }
  }

  assert.equal(getDraftFormat('cwc').kind, 'interactive');
});
