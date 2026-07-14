import { test } from 'node:test';
import assert from 'node:assert/strict';

import type {
  Civ6DraftResult,
  Civ7DraftResult,
} from '../../../src/shared/draft.types.js';

// Slice (R3) renderers — the port under test.
import {
  buildCiv6DirectDraftSummaryEmbed as sliceCiv6Embed,
  buildCiv7DirectDraftSummaryEmbed as sliceCiv7Embed,
} from '../../../src/features/drafting/ui/standard-draft.embed.js';
import {
  buildCiv6DirectDraftMessages as sliceCiv6Messages,
  buildCiv7DirectDraftMessages as sliceCiv7Messages,
} from '../../../src/features/drafting/ui/standard-draft.layout.js';

import {
  buildCiv6DirectDraftSummaryEmbed as legacyCiv6Embed,
  buildCiv7DirectDraftSummaryEmbed as legacyCiv7Embed,
} from '../../../src/ui/embeds/standard-draft.js';
import {
  buildCiv6DirectDraftMessages as legacyCiv6Messages,
  buildCiv7DirectDraftMessages as legacyCiv7Messages,
} from '../../../src/ui/layouts/standard-draft.js';

const civ6Duel: Civ6DraftResult = {
  gameVersion: 'civ6',
  gameType: 'Duel',
  allocation: {
    groupKind: 'Player',
    groupCount: 2,
    leadersPerGroup: 6,
    bannedLeaders: ['LEADER_SALADIN'],
    ignoredLeaderBans: ['not_a_real_leader'],
  },
  groups: [
    { leaders: ['LEADER_ABRAHAM_LINCOLN', 'LEADER_T_ROOSEVELT'] },
    { leaders: ['LEADER_T_ROOSEVELT_ROUGHRIDER', 'LEADER_SALADIN'] },
  ],
};

const civ6Teamer: Civ6DraftResult = {
  gameVersion: 'civ6',
  gameType: 'Teamer',
  allocation: {
    groupKind: 'Team',
    groupCount: 2,
    leadersPerGroup: 3,
    leadersPerGroupMax: 4,
    note: 'Pool trimmed for even teams.',
  },
  groups: [
    { leaders: ['LEADER_ABRAHAM_LINCOLN'] },
    { leaders: ['LEADER_SALADIN'] },
  ],
};

const civ7Ffa: Civ7DraftResult = {
  gameVersion: 'civ7',
  gameType: 'FFA',
  startingAge: 'Antiquity_Age',
  allocation: {
    groupKind: 'Player',
    groupCount: 2,
    leadersPerGroup: 4,
    civsPerGroup: 4,
    bannedLeaders: ['LEADER_AMINA'],
    bannedCivs: ['CIVILIZATION_PERSIA'],
    ignoredLeaderBans: [],
    ignoredCivBans: ['junk_civ'],
  },
  groups: [
    {
      leaders: ['LEADER_ADA_LOVELACE', 'LEADER_ASHOKA'],
      civs: ['CIVILIZATION_AKSUM', 'CIVILIZATION_ASSYRIA'],
    },
    {
      leaders: ['LEADER_ASHOKA_ALT', 'LEADER_AMINA'],
      civs: ['CIVILIZATION_PERSIA', 'CIVILIZATION_AKSUM'],
    },
  ],
};

test('civ6 command summary embed: slice output byte-identical to legacy', () => {
  for (const fixture of [civ6Duel, civ6Teamer]) {
    assert.deepEqual(
      sliceCiv6Embed(fixture).toJSON(),
      legacyCiv6Embed(fixture).toJSON()
    );
  }
});

test('civ6 command messages: slice output byte-identical to legacy', () => {
  for (const fixture of [civ6Duel, civ6Teamer]) {
    assert.deepEqual(sliceCiv6Messages(fixture), legacyCiv6Messages(fixture));
  }
});

test('civ7 command summary embed: slice output byte-identical to legacy', () => {
  assert.deepEqual(
    sliceCiv7Embed(civ7Ffa).toJSON(),
    legacyCiv7Embed(civ7Ffa).toJSON()
  );
});

test('civ7 command messages: slice output byte-identical to legacy', () => {
  assert.deepEqual(sliceCiv7Messages(civ7Ffa), legacyCiv7Messages(civ7Ffa));
});

test('civ7 summary embed reports the cross-group civ duplicate line', () => {
  const json = sliceCiv7Embed(civ7Ffa).toJSON() as { description?: string };
  assert.ok(json.description?.includes('Civ duplicates across groups: Allowed'));
});
