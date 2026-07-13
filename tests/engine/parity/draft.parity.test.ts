import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as legacyAlloc from '../../../src/services/drafting/domain/allocation.service.js';
import * as legacyPool from '../../../src/services/drafting/domain/pool.service.js';
import * as legacyRules from '../../../src/services/drafting/domain/rules.service.js';
import { buildVoteStandardDraftResult } from '../../../src/services/drafting/draft.service.js';
import type { VoteDraftRequest } from '../../../src/types/drafting.types.js';

import * as engAlloc from '../../../src/engine/drafts/allocation.js';
import * as engFormats from '../../../src/engine/drafts/formats.js';
import * as engPools from '../../../src/engine/drafts/pools.js';
import * as engRules from '../../../src/engine/drafts/rules.js';
import { createSeededRandom } from '../../../src/engine/random.js';
import type { DraftSessionConfig } from '../../../src/engine/types.js';

import { CIV6_LEADERS } from '../../../src/data/civ6.data.js';
import { CIV7_CIVS, CIV7_LEADERS } from '../../../src/data/civ7.data.js';
import type { Civ6LeaderKey, Civ7CivKey, Civ7LeaderKey, Civ7StartingAge } from '../../../src/data/types.js';
import type { Civ6DraftRequest, Civ7DraftRequest, DraftGameType } from '../../../src/shared/draft.types.js';

type ThrownShape = Readonly<{ code: string; message: string }>;

function capture<T>(fn: () => T): { value?: T; thrown?: ThrownShape } {
  try {
    return { value: fn() };
  } catch (err: unknown) {
    const shaped = err as { code?: string; message?: string };
    return { thrown: { code: shaped.code ?? 'NONE', message: shaped.message ?? '' } };
  }
}

function assertSameOutcome<T>(legacy: () => T, engine: () => T, label: string): void {
  const l = capture(legacy);
  const e = capture(engine);
  if (l.thrown || e.thrown) {
    assert.deepEqual(e.thrown, l.thrown, `${label}: throw parity`);
    return;
  }
  assert.deepEqual(e.value, l.value, label);
}

type GroupsResult = Readonly<{
  allocation: Record<string, unknown>;
  groups: readonly Readonly<{ leaders: readonly string[]; civs?: readonly string[] }>[];
}>;

function detFields(result: GroupsResult): unknown {
  return {
    allocation: result.allocation,
    groupSizes: result.groups.map((group) => ({
      leaders: group.leaders.length,
      civs: group.civs?.length ?? null,
    })),
  };
}

const rng = (): ReturnType<typeof createSeededRandom> => createSeededRandom('parity-seed');

test('rules: computeLeadersPerGroup parity across the full input grid', () => {
  for (const gameVersion of ['civ6', 'civ7'] as const) {
    for (const gameType of ['FFA', 'Teamer', 'Duel'] as const) {
      for (let groupCount = 2; groupCount <= 16; groupCount += 1) {
        for (const remainingLeaderCount of [0, 1, 5, 11, 12, 13, 20, 40, 53, 60, 80]) {
          const args = { gameVersion, gameType, groupCount, remainingLeaderCount };
          assertSameOutcome(
            () => legacyRules.computeLeadersPerGroup(args),
            () => engRules.computeLeadersPerGroup(args),
            JSON.stringify(args),
          );
        }
      }
    }
  }
});

test('rules: getCiv7CivTarget + buildAllocationNote parity', () => {
  for (const gameType of ['FFA', 'Teamer', 'Duel'] as const) {
    for (let groupCount = 2; groupCount <= 16; groupCount += 1) {
      assert.equal(
        engRules.getCiv7CivTarget(gameType, groupCount),
        legacyRules.getCiv7CivTarget(gameType, groupCount),
      );
    }
  }
  assert.equal(engRules.buildAllocationNote(['a', undefined, 'b']), legacyRules.buildAllocationNote(['a', undefined, 'b']));
  assert.equal(engRules.buildAllocationNote([undefined]), legacyRules.buildAllocationNote([undefined]));
  assert.equal(engRules.buildAllocationNote([]), legacyRules.buildAllocationNote([]));
});

test('pools: ban index construction parity (keys, gameIds, emoji snowflakes)', () => {
  assert.deepEqual(
    [...engPools.buildLeaderBanIndex(CIV6_LEADERS).entries()],
    [...legacyPool.buildLeaderBanIndex(CIV6_LEADERS).entries()],
  );
  assert.deepEqual(
    [...engPools.buildLeaderBanIndex(CIV7_LEADERS).entries()],
    [...legacyPool.buildLeaderBanIndex(CIV7_LEADERS).entries()],
  );
  assert.deepEqual(
    [...engPools.buildCivBanIndex(CIV7_CIVS).entries()],
    [...legacyPool.buildCivBanIndex(CIV7_CIVS).entries()],
  );
});

test('pools: tokenize + resolveEmojiBans + available-key parity', () => {
  const banInputs: (string | undefined)[] = [
    undefined,
    '',
    ':Cleopatra:',
    '<:Cleopatra:123456789012345678>, :Gandhi:\n:Gandhi:, junk, :NotALeader:',
    ':Abraham_Lincoln:,:Abraham_Lincoln:',
    'plain text, <a:Teddy_Bull_Moose:123456789012345679>',
  ];
  const legacyIndex = legacyPool.buildLeaderBanIndex(CIV6_LEADERS);
  const engineIndex = engPools.buildLeaderBanIndex(CIV6_LEADERS);

  for (const raw of banInputs) {
    const legacyTokens = legacyPool.tokenizeBans(raw);
    const engineTokens = engPools.tokenizeBans(raw);
    assert.deepEqual(engineTokens, legacyTokens, `tokenize(${String(raw)})`);

    const legacyResolved = legacyPool.resolveEmojiBans(legacyTokens, legacyIndex, 'leader');
    const engineResolved = engPools.resolveEmojiBans(engineTokens, engineIndex, 'leader');
    assert.deepEqual(engineResolved.accepted, legacyResolved.accepted);
    assert.deepEqual(engineResolved.ignored, legacyResolved.ignored);
    assert.deepEqual([...engineResolved.banned], [...legacyResolved.banned]);

    assert.deepEqual(
      engPools.getAvailableCiv6LeaderKeys(engineResolved.banned),
      legacyPool.getAvailableCiv6LeaderKeys(legacyResolved.banned as ReadonlySet<Civ6LeaderKey>),
    );
  }

  for (const startingAge of ['Antiquity_Age', 'Exploration_Age', 'Modern_Age', 'None']) {
    assert.deepEqual(
      engPools.getAvailableCiv7CivKeys({ startingAge, banned: new Set<Civ7CivKey>() }),
      legacyPool.getAvailableCiv7CivKeys({ startingAge: startingAge as Civ7StartingAge, banned: new Set<Civ7CivKey>() }),
    );
  }
  assert.deepEqual(
    engPools.getAvailableCiv7LeaderKeys(new Set<Civ7LeaderKey>()),
    legacyPool.getAvailableCiv7LeaderKeys(new Set<Civ7LeaderKey>()),
  );
});

test('pools: keyed vote pool builders parity', () => {
  const bannedLeaders = Object.keys(CIV7_LEADERS).slice(0, 3);
  assert.deepEqual(
    engPools.buildKeyedLeaderPool({ edition: 'CIV7', bannedLeaderKeys: bannedLeaders }),
    legacyPool.buildVoteLeaderPool({ edition: 'CIV7', bannedLeaderKeys: bannedLeaders } as never),
  );
  assert.deepEqual(
    engPools.buildKeyedLeaderPool({ edition: 'CIV6', bannedLeaderKeys: Object.keys(CIV6_LEADERS).slice(0, 2) }),
    legacyPool.buildVoteLeaderPool({ edition: 'CIV6', bannedLeaderKeys: Object.keys(CIV6_LEADERS).slice(0, 2) } as never),
  );
  const bannedCivs = Object.keys(CIV7_CIVS).slice(0, 2);
  assert.deepEqual(
    engPools.buildKeyedCivPool({ edition: 'CIV7', startingAge: 'Antiquity_Age', bannedCivKeys: bannedCivs }),
    legacyPool.buildVoteCivPool({ edition: 'CIV7', startingAge: 'Antiquity_Age', bannedCivKeys: bannedCivs } as never),
  );
  assert.deepEqual(
    engPools.buildKeyedCivPool({ edition: 'CIV6', bannedCivKeys: [] }),
    legacyPool.buildVoteCivPool({ edition: 'CIV6', bannedCivKeys: [] } as never),
  );
  // startingAge default branch (undefined → Antiquity_Age)
  assert.deepEqual(
    engPools.buildKeyedCivPool({ edition: 'CIV7', bannedCivKeys: [] }),
    legacyPool.buildVoteCivPool({ edition: 'CIV7', startingAge: 'Antiquity_Age', bannedCivKeys: [] } as never),
  );
});

test('allocation: computeLayout parity including every validation error', () => {
  const cases: Readonly<{ gameType: DraftGameType; numberPlayers?: number; numberTeams?: number }>[] = [
    { gameType: 'FFA', numberPlayers: 6 },
    { gameType: 'FFA', numberPlayers: 1 },
    { gameType: 'FFA' },
    { gameType: 'FFA', numberPlayers: 4, numberTeams: 2 },
    { gameType: 'Teamer', numberTeams: 3 },
    { gameType: 'Teamer', numberTeams: 1 },
    { gameType: 'Teamer' },
    { gameType: 'Teamer', numberPlayers: 4, numberTeams: 2 },
    { gameType: 'Duel' },
    { gameType: 'Duel', numberPlayers: 2 },
    { gameType: 'Duel', numberTeams: 2 },
  ];
  for (const gameVersion of ['civ6', 'civ7'] as const) {
    for (const layoutCase of cases) {
      assertSameOutcome(
        () => legacyAlloc.computeLayout({ gameVersion, ...layoutCase }),
        () => engAlloc.computeLayout({ gameVersion, ...layoutCase }),
        `${gameVersion} ${JSON.stringify(layoutCase)}`,
      );
    }
  }
});

test('allocation: direct civ6 core — deterministic fields, invariants, seed determinism', () => {
  const requests: Civ6DraftRequest[] = [
    { gameType: 'FFA', numberPlayers: 6 },
    { gameType: 'FFA', numberPlayers: 6, leaderBansRaw: ':Cleopatra:, :NotALeader:' },
    { gameType: 'Teamer', numberTeams: 2 },
    { gameType: 'Duel' },
  ];
  for (const request of requests) {
    const legacyResult = legacyAlloc.generateDirectCiv6DraftCore(request);
    const engineResult = engAlloc.generateDirectCiv6DraftCore(request, rng());
    const engineRepeat = engAlloc.generateDirectCiv6DraftCore(request, rng());
    assert.deepEqual(detFields(engineResult), detFields(legacyResult), JSON.stringify(request));
    assert.deepEqual(engineResult, engineRepeat, 'seed determinism');

    const dealt = engineResult.groups.flatMap((group) => group.leaders);
    assert.equal(new Set(dealt).size, dealt.length, 'unique leaders');
    const banned = new Set(engineResult.allocation.bannedLeaders ?? []);
    for (const key of dealt) {
      assert.ok(key in CIV6_LEADERS, 'pool membership');
      assert.ok(!banned.has(key), 'ban exclusion');
    }
  }
});

test('allocation: typed civ6 core parity', () => {
  const request: Civ6DraftRequest = { gameType: 'FFA', numberPlayers: 4 };
  const legacyResult = legacyAlloc.generateCiv6DraftCore(request);
  const engineResult = engAlloc.generateCiv6DraftCore(request, rng());
  assert.deepEqual(detFields(engineResult), detFields(legacyResult));
  const dealt = engineResult.groups.flatMap((group) => group.leaders);
  assert.equal(new Set(dealt).size, dealt.length);
});

test('allocation: civ7 cores parity (direct + vote-typed) across ages', () => {
  const directRequests: Civ7DraftRequest[] = [
    { gameType: 'FFA', startingAge: 'Antiquity_Age', numberPlayers: 6 },
    { gameType: 'FFA', startingAge: 'None', numberPlayers: 8 },
    { gameType: 'Teamer', startingAge: 'Modern_Age', numberTeams: 2 },
    { gameType: 'Duel', startingAge: 'Exploration_Age' },
    {
      gameType: 'FFA',
      startingAge: 'Antiquity_Age',
      numberPlayers: 4,
      leaderBansRaw: ':Ada_Lovelace:, :NotALeader:',
      civBansRaw: `:${CIV7_CIVS[Object.keys(CIV7_CIVS)[0] as Civ7CivKey].gameId}:, :NotACiv:`,
    },
  ];
  for (const request of directRequests) {
    const legacyResult = legacyAlloc.generateDirectCiv7DraftCore(request);
    const engineResult = engAlloc.generateDirectCiv7DraftCore(request, rng());
    assert.deepEqual(detFields(engineResult), detFields(legacyResult), JSON.stringify(request));
    const dealtLeaders = engineResult.groups.flatMap((group) => group.leaders);
    assert.equal(new Set(dealtLeaders).size, dealtLeaders.length);
  }

  const typedRequest: Civ7DraftRequest = { gameType: 'FFA', startingAge: 'Antiquity_Age', numberPlayers: 4 };
  assert.deepEqual(
    detFields(engAlloc.generateCiv7DraftCore(typedRequest, rng())),
    detFields(legacyAlloc.generateCiv7DraftCore(typedRequest)),
  );
});

test('allocation: NO_POOL error parity (leader pool exhausted)', () => {
  const banEverything = Object.values(CIV6_LEADERS)
    .map((meta) => `:${meta.gameId}:`)
    .join(',');
  const request: Civ6DraftRequest = { gameType: 'FFA', numberPlayers: 4, leaderBansRaw: banEverything };
  assertSameOutcome(
    () => legacyAlloc.generateDirectCiv6DraftCore(request),
    () => engAlloc.generateDirectCiv6DraftCore(request, rng()),
    'exhausted leader pool',
  );
});

test('formats: resolveVoteStandardDraft parity vs frozen buildVoteStandardDraftResult', () => {
  const seatIds = ['u1', 'u2', 'u3', 'u4'];

  const banned6 = Object.keys(CIV6_LEADERS).slice(0, 4);
  const legacy6: VoteDraftRequest = {
    source: 'vote',
    edition: 'CIV6',
    draftMode: 'standard',
    gameType: 'FFA',
    numberPlayers: seatIds.length,
    voterIds: seatIds,
    voteUuid: 'v-1',
    commandChannel: null as never,
    hostId: 'u1',
    bannedLeaderKeys: banned6,
    bannedCivKeys: [],
  } as never;
  const engine6: DraftSessionConfig = {
    sessionId: 's-1',
    voteUuid: 'v-1',
    edition: 'CIV6',
    gameType: 'FFA',
    hostId: 'u1',
    seatIds,
    bannedLeaderKeys: banned6,
    bannedCivKeys: [],
  };
  assert.deepEqual(
    detFields(engFormats.resolveVoteStandardDraft(engine6, rng()) as GroupsResult),
    detFields(buildVoteStandardDraftResult(legacy6) as GroupsResult),
  );

  const banned7Leaders = Object.keys(CIV7_LEADERS).slice(0, 3);
  const banned7Civs = Object.keys(CIV7_CIVS).slice(0, 2);
  const legacy7: VoteDraftRequest = {
    ...legacy6,
    edition: 'CIV7',
    gameType: 'Teamer',
    numberPlayers: undefined,
    numberTeams: 2,
    startingAge: 'Antiquity_Age',
    bannedLeaderKeys: banned7Leaders,
    bannedCivKeys: banned7Civs,
  } as never;
  const engine7: DraftSessionConfig = {
    sessionId: 's-2',
    voteUuid: 'v-2',
    edition: 'CIV7',
    gameType: 'Teamer',
    numberTeams: 2,
    startingAge: 'Antiquity_Age',
    hostId: 'u1',
    seatIds,
    bannedLeaderKeys: banned7Leaders,
    bannedCivKeys: banned7Civs,
  };
  assert.deepEqual(
    detFields(engFormats.resolveVoteStandardDraft(engine7, rng()) as GroupsResult),
    detFields(buildVoteStandardDraftResult(legacy7) as GroupsResult),
  );

  // startingAge omitted → legacy default Antiquity_Age
  const engine7Default: DraftSessionConfig = { ...engine7, sessionId: 's-3', startingAge: undefined };
  assert.deepEqual(
    detFields(engFormats.resolveVoteStandardDraft(engine7Default, rng()) as GroupsResult),
    detFields(buildVoteStandardDraftResult(legacy7) as GroupsResult),
  );
});

// ── civ7 civ-pool edge branches (typed + direct cores) ───────

function civ7CivTokens(keys: readonly string[]): string {
  return keys.map((key) => `:${CIV7_CIVS[key as Civ7CivKey].gameId}:`).join(',');
}

const ANTIQUITY_CIVS = (Object.keys(CIV7_CIVS) as Civ7CivKey[]).filter(
  (key) => CIV7_CIVS[key].agePool === 'Antiquity_Age',
);
const NON_ANTIQUITY_CIVS = (Object.keys(CIV7_CIVS) as Civ7CivKey[]).filter(
  (key) => CIV7_CIVS[key].agePool !== 'Antiquity_Age',
);

test('allocation: civ7 cores ignore out-of-age civ bans and report them (typed + direct)', () => {
  const request: Civ7DraftRequest = {
    gameType: 'FFA',
    startingAge: 'Antiquity_Age',
    numberPlayers: 4,
    leaderBansRaw: `:${CIV7_LEADERS[Object.keys(CIV7_LEADERS)[0] as Civ7LeaderKey].gameId}:`,
    civBansRaw: civ7CivTokens([ANTIQUITY_CIVS[0] as Civ7CivKey, NON_ANTIQUITY_CIVS[0] as Civ7CivKey]),
  };

  const typedEngine = engAlloc.generateCiv7DraftCore(request, rng());
  const typedLegacy = legacyAlloc.generateCiv7DraftCore(request);
  assert.deepEqual(detFields(typedEngine), detFields(typedLegacy));
  assert.deepEqual(typedEngine.allocation.bannedCivs, [ANTIQUITY_CIVS[0]], 'only in-age bans accepted');
  assert.ok(
    (typedEngine.allocation.ignoredCivBans ?? []).some((entry) => entry.includes('(not in Antiquity_Age)')),
    'out-of-age ban reported as ignored',
  );

  const directEngine = engAlloc.generateDirectCiv7DraftCore(request, rng());
  assert.deepEqual(detFields(directEngine), detFields(legacyAlloc.generateDirectCiv7DraftCore(request)));
  assert.deepEqual(directEngine.allocation.bannedCivs, [ANTIQUITY_CIVS[0]]);
});

test('allocation: civ7 cores throw NO_POOL when every in-age civ is banned (typed + direct)', () => {
  const request: Civ7DraftRequest = {
    gameType: 'FFA',
    startingAge: 'Antiquity_Age',
    numberPlayers: 4,
    civBansRaw: civ7CivTokens(ANTIQUITY_CIVS),
  };
  assertSameOutcome(
    () => legacyAlloc.generateCiv7DraftCore(request),
    () => engAlloc.generateCiv7DraftCore(request, rng()),
    'typed civ7 exhausted civ pool',
  );
  assertSameOutcome(
    () => legacyAlloc.generateDirectCiv7DraftCore(request),
    () => engAlloc.generateDirectCiv7DraftCore(request, rng()),
    'direct civ7 exhausted civ pool',
  );
});

test('allocation: typed civ7 core falls back to per-group draws when the civ pool is too small', () => {
  // Duel → civ target 4 per group × 2 groups = 8 needed; leave 5 in the pool.
  const keep = ANTIQUITY_CIVS.slice(0, 5);
  const request: Civ7DraftRequest = {
    gameType: 'Duel',
    startingAge: 'Antiquity_Age',
    civBansRaw: civ7CivTokens(ANTIQUITY_CIVS.filter((key) => !keep.includes(key))),
  };
  const engineResult = engAlloc.generateCiv7DraftCore(request, rng());
  assert.deepEqual(detFields(engineResult), detFields(legacyAlloc.generateCiv7DraftCore(request)));
  for (const group of engineResult.groups) {
    const civs = group.civs ?? [];
    assert.equal(civs.length, 4, 'each group still gets its civ target');
    assert.equal(new Set(civs).size, civs.length, 'within a group civs stay distinct');
    assert.ok(civs.every((key) => keep.includes(key as Civ7CivKey)), 'draws stay inside the surviving pool');
  }
});

test('allocation: direct civ7 core with a minimal civ pool (evenFloor clamp) and singular removed-note wording', () => {
  // one civ, two groups → evenFloor 0 → clamped to 1 → per-group draw fallback
  const keepOne = ANTIQUITY_CIVS.slice(0, 1);
  const oneCiv: Civ7DraftRequest = {
    gameType: 'Duel',
    startingAge: 'Antiquity_Age',
    civBansRaw: civ7CivTokens(ANTIQUITY_CIVS.filter((key) => !keepOne.includes(key))),
  };
  const engineResult = engAlloc.generateDirectCiv7DraftCore(oneCiv, rng());
  assert.deepEqual(detFields(engineResult), detFields(legacyAlloc.generateDirectCiv7DraftCore(oneCiv)));
  for (const group of engineResult.groups) {
    assert.deepEqual(group.civs, keepOne, 'the single surviving civ is dealt to every group');
  }

  // removed-note wording is produced by the legacy formatter; parity covers both
  // the singular ("1 leader") and plural forms across group counts.
  for (const numberPlayers of [3, 5, 7]) {
    const request: Civ6DraftRequest = { gameType: 'FFA', numberPlayers };
    assert.deepEqual(
      detFields(engAlloc.generateDirectCiv6DraftCore(request, rng())),
      detFields(legacyAlloc.generateDirectCiv6DraftCore(request)),
      `removed-note parity for ${numberPlayers} players`,
    );
  }
});

test('allocation: typed civ7 core deals unique civ groups when the pool is large enough', () => {
  // startingAge 'None' opens the full civ catalogue → pool >= civsPerGroup * groups
  const request: Civ7DraftRequest = { gameType: 'FFA', startingAge: 'None', numberPlayers: 4 };
  const engineResult = engAlloc.generateCiv7DraftCore(request, rng());
  assert.deepEqual(detFields(engineResult), detFields(legacyAlloc.generateCiv7DraftCore(request)));

  const dealtCivs = engineResult.groups.flatMap((group) => group.civs ?? []);
  assert.equal(dealtCivs.length, 16, '4 civs per group across 4 groups');
  assert.equal(new Set(dealtCivs).size, dealtCivs.length, 'civ groups are disjoint on the unique path');
});
