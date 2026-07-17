import assert from 'node:assert/strict';
import { test } from 'node:test';

import { getCiv6DraftModeQuestion } from '../../../src/config/civ6-voting.config.js';
import { getCiv7DraftModeQuestion } from '../../../src/config/civ7-voting.config.js';
import { DRAFT_FORMATS, isDraftFormatAllowed } from '../../../src/engine/draft/formats.js';
import type { DraftFormatId } from '../../../src/engine/draft/formats.js';
import type { DraftGameType } from '../../../src/shared/draft.types.js';

const GAME_TYPES: readonly DraftGameType[] = ['FFA', 'Teamer', 'Duel'];

test('vote-config draft-mode options equal the engine legality matrix (both editions)', () => {
  for (const [edition, question] of [
    ['CIV6', getCiv6DraftModeQuestion],
    ['CIV7', getCiv7DraftModeQuestion],
  ] as const) {
    for (const gameType of GAME_TYPES) {
      const offered: readonly string[] = question(gameType).options.map((option) => option.id).sort();
      const allowed: readonly string[] = DRAFT_FORMATS.filter((format) => format.gameTypes.includes(gameType))
        .map((format) => format.id)
        .sort();

      assert.ok(!offered.includes('random'), `${edition} ${gameType}: random must not be offered (D14)`);
      for (const id of offered) {
        assert.ok(isDraftFormatAllowed(id as DraftFormatId, gameType), `${edition} ${gameType} ${id}`);
      }

      // NB: node's assert.deepEqual is declared `asserts actual is T`, so
      // comparing the variables directly would narrow `offered` to
      // DraftFormatId[] for the rest of the block. Compare copies.
      assert.deepEqual([...offered], [...allowed], `${edition} ${gameType}`);
    }
  }
});

test('every draft-mode question still defaults to a legal option', () => {
  for (const question of [getCiv6DraftModeQuestion, getCiv7DraftModeQuestion]) {
    for (const gameType of GAME_TYPES) {
      const q = question(gameType);
      assert.ok(
        q.options.some((option) => option.id === q.defaultOptionId),
        `${gameType}: default ${q.defaultOptionId} must be offered`,
      );
      assert.ok(isDraftFormatAllowed(q.defaultOptionId as DraftFormatId, gameType));
    }
  }
});
