import { CIV6_LEADERS } from '../../data/civ6.data.js';
import { CIV7_CIVS, CIV7_LEADERS } from '../../data/civ7.data.js';
import type {
  Civ6LeaderKey,
  Civ7CivKey,
  Civ7LeaderKey,
  LeaderType,
} from '../../data/types.js';
import type {
  Civ6DraftRequest,
  Civ6DraftResult,
  Civ7DraftRequest,
  Civ7DraftResult,
  DraftGameType,
  DraftGroup,
  DraftGroupKind,
} from '../../shared/draft.types.js';
import type { RandomSource } from '../random.js';
import { shuffleInPlace } from '../random.js';
import {
  buildCivBanIndex,
  buildLeaderBanIndex,
  getAvailableCiv6LeaderKeys,
  getAvailableCiv7CivKeys,
  getAvailableCiv7LeaderKeys,
  resolveEmojiBans,
  tokenizeBans,
} from './pools.js';
import {
  buildAllocationNote,
  computeLeadersPerGroup,
  getCiv7CivTarget,
  LEADER_TYPES,
} from './rules.js';
import { DraftError } from './errors.js';

export function computeLayout(args: Readonly<{
  gameVersion: 'civ6' | 'civ7';
  gameType: DraftGameType;
  numberPlayers?: number;
  numberTeams?: number;
}>): Readonly<{ groupKind: DraftGroupKind; groupCount: number }> {
  const { gameType, numberPlayers, numberTeams } = args;

  if (gameType === 'FFA') {
    if (numberTeams !== undefined) {
      throw new DraftError('VALIDATION', 'For FFA, use number-players (do not provide number-teams).');
    }
    if (numberPlayers === undefined) {
      throw new DraftError('VALIDATION', 'For FFA, number-players is required.');
    }
    if (numberPlayers < 2) {
      throw new DraftError('VALIDATION', 'For FFA, number-players must be at least 2.');
    }
    return { groupKind: 'Player', groupCount: numberPlayers };
  }

  if (gameType === 'Teamer') {
    if (numberPlayers !== undefined) {
      throw new DraftError('VALIDATION', 'For Teamer, use number-teams (do not provide number-players).');
    }
    if (numberTeams === undefined) {
      throw new DraftError('VALIDATION', 'For Teamer, number-teams is required.');
    }
    if (numberTeams < 2) {
      throw new DraftError('VALIDATION', 'For Teamer, number-teams must be at least 2.');
    }
    return { groupKind: 'Team', groupCount: numberTeams };
  }

  if (numberPlayers !== undefined || numberTeams !== undefined) {
    throw new DraftError('VALIDATION', 'For Duel, do not provide number-players or number-teams.');
  }

  return { groupKind: 'Player', groupCount: 2 };
}

function dealUnique<T>(pool: T[], count: number): T[] {
  return pool.splice(0, count);
}

function pickDistinct<T>(pool: readonly T[], count: number, rng: RandomSource): T[] {
  if (count <= 0) return [];
  const copy = pool.slice();
  shuffleInPlace(copy, rng);
  return copy.slice(0, Math.min(count, copy.length));
}

function clampAtLeast1(n: number): number {
  return n < 1 ? 1 : n;
}

function dealCiv6LeadersByType(args: Readonly<{
  availableKeys: readonly Civ6LeaderKey[];
  leadersPerGroup: number;
  groupCount: number;
  rng: RandomSource;
}>): DraftGroup[] {
  const { availableKeys, leadersPerGroup, groupCount, rng } = args;

  const buckets = new Map<LeaderType, Civ6LeaderKey[]>();
  for (const type of LEADER_TYPES) {
    buckets.set(type, []);
  }

  for (const key of availableKeys) {
    const meta = CIV6_LEADERS[key];
    const type = meta?.type ?? 'None';
    (buckets.get(type) ?? buckets.get('None')!).push(key);
  }

  for (const arr of buckets.values()) {
    shuffleInPlace(arr, rng);
  }

  const groups: DraftGroup[] = Array.from({ length: groupCount }, () => ({ leaders: [] }));
  const typeCount = LEADER_TYPES.length;

  for (let groupIndex = 0; groupIndex < groupCount; groupIndex += 1) {
    const picks: Civ6LeaderKey[] = [];
    let cursor = groupIndex % typeCount;

    for (let i = 0; i < leadersPerGroup; i += 1) {
      let chosen: Civ6LeaderKey | undefined;

      for (let step = 0; step < typeCount; step += 1) {
        const type = LEADER_TYPES[(cursor + step) % typeCount] as LeaderType;
        const arr = buckets.get(type);
        const value = arr?.pop();
        if (value) {
          chosen = value;
          cursor = (cursor + step + 1) % typeCount;
          break;
        }
      }

      if (!chosen) {
        throw new DraftError(
          'NO_POOL',
          'Not enough leaders remaining to complete the draft. Remove bans or reduce players/teams.',
        );
      }

      picks.push(chosen);
    }

    groups[groupIndex] = { leaders: picks };
  }

  return groups;
}

function dealEvenUniqueGroups<T>(pool: readonly T[], targets: readonly number[]): T[][] {
  const remaining = pool.slice();
  const groups: T[][] = [];

  for (const target of targets) {
    if (remaining.length < target) {
      throw new DraftError('NO_POOL', 'Not enough items remain to complete the draft allocation.');
    }
    groups.push(dealUnique(remaining, target));
  }

  return groups;
}

function buildUniformTargets(total: number, groupCount: number): Readonly<{
  perGroup: number;
  removedCount: number;
  targets: readonly number[];
}> {
  const perGroup = Math.floor(total / groupCount);
  const removedCount = total % groupCount;

  if (perGroup < 1) {
    throw new DraftError('NO_POOL', 'Not enough items remain after bans for the selected draft size.');
  }

  return {
    perGroup,
    removedCount,
    targets: Array.from({ length: groupCount }, () => perGroup),
  };
}

function buildRemovedPoolNote(args: Readonly<{
  leaderRemovedCount?: number;
  civRemovedCount?: number;
}>): string | undefined {
  const parts: string[] = [];

  if ((args.leaderRemovedCount ?? 0) > 0) {
    parts.push(`${args.leaderRemovedCount} leader${args.leaderRemovedCount === 1 ? '' : 's'}`);
  }

  if ((args.civRemovedCount ?? 0) > 0) {
    parts.push(`${args.civRemovedCount} civ${args.civRemovedCount === 1 ? '' : 's'}`);
  }

  if (parts.length === 0) return undefined;
  return `Even split adjustment: ${parts.join(' and ')} removed from the usable pool.`;
}

export function generateCiv6DraftCore(req: Civ6DraftRequest, rng: RandomSource): Civ6DraftResult {
  const { groupKind, groupCount } = computeLayout({
    gameVersion: 'civ6',
    gameType: req.gameType,
    numberPlayers: req.numberPlayers,
    numberTeams: req.numberTeams,
  });

  const leaderIndex = buildLeaderBanIndex(CIV6_LEADERS);
  const leaderBans = resolveEmojiBans(tokenizeBans(req.leaderBansRaw), leaderIndex, 'leader');
  const available = getAvailableCiv6LeaderKeys(leaderBans.banned as ReadonlySet<Civ6LeaderKey>);

  const { leadersPerGroup, note } = computeLeadersPerGroup({
    gameVersion: 'civ6',
    gameType: req.gameType,
    groupCount,
    remainingLeaderCount: available.length,
  });

  const groups = dealCiv6LeadersByType({
    availableKeys: available,
    leadersPerGroup,
    groupCount,
    rng,
  });

  return {
    gameVersion: 'civ6',
    gameType: req.gameType,
    allocation: {
      groupKind,
      groupCount,
      leadersPerGroup,
      note,
      bannedLeaders: leaderBans.accepted,
      ignoredLeaderBans: leaderBans.ignored,
    },
    groups,
  };
}

export function generateDirectCiv6DraftCore(req: Civ6DraftRequest, rng: RandomSource): Civ6DraftResult {
  const { groupKind, groupCount } = computeLayout({
    gameVersion: 'civ6',
    gameType: req.gameType,
    numberPlayers: req.numberPlayers,
    numberTeams: req.numberTeams,
  });

  const leaderIndex = buildLeaderBanIndex(CIV6_LEADERS);
  const leaderBans = resolveEmojiBans(tokenizeBans(req.leaderBansRaw), leaderIndex, 'leader');

  const leaderPool = getAvailableCiv6LeaderKeys(leaderBans.banned as ReadonlySet<Civ6LeaderKey>);
  shuffleInPlace(leaderPool, rng);

  const leaderTargets = buildUniformTargets(leaderPool.length, groupCount);
  const leaderGroups = dealEvenUniqueGroups(leaderPool, leaderTargets.targets);

  return {
    gameVersion: 'civ6',
    gameType: req.gameType,
    allocation: {
      groupKind,
      groupCount,
      leadersPerGroup: leaderTargets.perGroup,
      note: buildRemovedPoolNote({ leaderRemovedCount: leaderTargets.removedCount }),
      bannedLeaders: leaderBans.accepted,
      ignoredLeaderBans: leaderBans.ignored,
    },
    groups: leaderGroups.map((leaders) => ({ leaders })),
  };
}

export function generateCiv7DraftCore(req: Civ7DraftRequest, rng: RandomSource): Civ7DraftResult {
  const { groupKind, groupCount } = computeLayout({
    gameVersion: 'civ7',
    gameType: req.gameType,
    numberPlayers: req.numberPlayers,
    numberTeams: req.numberTeams,
  });

  const leaderIndex = buildLeaderBanIndex(CIV7_LEADERS);
  const civIndex = buildCivBanIndex(CIV7_CIVS);

  const leaderBans = resolveEmojiBans(tokenizeBans(req.leaderBansRaw), leaderIndex, 'leader');
  const civBansAll = resolveEmojiBans(tokenizeBans(req.civBansRaw), civIndex, 'civ');

  const allowAllAges = req.startingAge === 'None';
  const bannedCivs = new Set<Civ7CivKey>();
  const acceptedCivs: Civ7CivKey[] = [];
  const ignoredCivBans: string[] = [...civBansAll.ignored];
  for (const key of civBansAll.accepted as Civ7CivKey[]) {
    const meta = CIV7_CIVS[key];
    if (!allowAllAges && meta.agePool !== req.startingAge) {
      ignoredCivBans.push(`${meta.gameId} (not in ${req.startingAge})`);
      continue;
    }
    bannedCivs.add(key);
    acceptedCivs.push(key);
  }

  const leaderPool = getAvailableCiv7LeaderKeys(leaderBans.banned as ReadonlySet<Civ7LeaderKey>);

  const leaderSizing = computeLeadersPerGroup({
    gameVersion: 'civ7',
    gameType: req.gameType,
    groupCount,
    remainingLeaderCount: leaderPool.length,
  });

  const civPool = getAvailableCiv7CivKeys({
    startingAge: req.startingAge,
    banned: bannedCivs,
  });

  if (civPool.length < 1) {
    const label = allowAllAges ? 'all ages' : String(req.startingAge);
    throw new DraftError('NO_POOL', `No civs available for ${label} after bans. Remove civ bans or pick a different age.`);
  }

  const civsPerGroup = getCiv7CivTarget(req.gameType, groupCount);
  const allocationNote = buildAllocationNote([leaderSizing.note]);

  shuffleInPlace(leaderPool, rng);
  const groups: DraftGroup[] = [];

  const leadersPerGroup = leaderSizing.leadersPerGroup;
  for (let i = 0; i < groupCount; i += 1) {
    const leaders = dealUnique(leaderPool, leadersPerGroup);
    groups.push({ leaders, civs: [] });
  }

  if (civPool.length >= civsPerGroup * groupCount) {
    const copy = civPool.slice();
    shuffleInPlace(copy, rng);
    const civTargets = Array.from({ length: groupCount }, () => civsPerGroup);
    const civGroups = dealEvenUniqueGroups(copy, civTargets);

    for (let i = 0; i < groupCount; i += 1) {
      groups[i] = { leaders: (groups[i] as DraftGroup).leaders, civs: civGroups[i] };
    }
  } else {
    for (let i = 0; i < groupCount; i += 1) {
      groups[i] = { leaders: (groups[i] as DraftGroup).leaders, civs: pickDistinct(civPool, civsPerGroup, rng) };
    }
  }

  return {
    gameVersion: 'civ7',
    gameType: req.gameType,
    startingAge: req.startingAge,
    allocation: {
      groupKind,
      groupCount,
      leadersPerGroup: leaderSizing.leadersPerGroup,
      civsPerGroup,
      note: allocationNote,
      bannedLeaders: leaderBans.accepted,
      ignoredLeaderBans: leaderBans.ignored,
      bannedCivs: acceptedCivs,
      ignoredCivBans,
    },
    groups,
  };
}

export function generateDirectCiv7DraftCore(req: Civ7DraftRequest, rng: RandomSource): Civ7DraftResult {
  const { groupKind, groupCount } = computeLayout({
    gameVersion: 'civ7',
    gameType: req.gameType,
    numberPlayers: req.numberPlayers,
    numberTeams: req.numberTeams,
  });

  const leaderIndex = buildLeaderBanIndex(CIV7_LEADERS);
  const civIndex = buildCivBanIndex(CIV7_CIVS);

  const leaderBans = resolveEmojiBans(tokenizeBans(req.leaderBansRaw), leaderIndex, 'leader');
  const civBansAll = resolveEmojiBans(tokenizeBans(req.civBansRaw), civIndex, 'civ');

  const allowAllAges = req.startingAge === 'None';
  const bannedCivs = new Set<Civ7CivKey>();
  const acceptedCivs: Civ7CivKey[] = [];
  const ignoredCivBans: string[] = [...civBansAll.ignored];
  for (const key of civBansAll.accepted as Civ7CivKey[]) {
    const meta = CIV7_CIVS[key];
    if (!allowAllAges && meta.agePool !== req.startingAge) {
      ignoredCivBans.push(`${meta.gameId} (not in ${req.startingAge})`);
      continue;
    }
    bannedCivs.add(key);
    acceptedCivs.push(key);
  }

  const leaderPool = getAvailableCiv7LeaderKeys(leaderBans.banned as ReadonlySet<Civ7LeaderKey>);
  shuffleInPlace(leaderPool, rng);
  const leaderTargets = buildUniformTargets(leaderPool.length, groupCount);
  const leaderGroups = dealEvenUniqueGroups(leaderPool, leaderTargets.targets);

  const civPool = getAvailableCiv7CivKeys({
    startingAge: req.startingAge,
    banned: bannedCivs,
  });

  if (civPool.length < 1) {
    const label = allowAllAges ? 'all ages' : String(req.startingAge);
    throw new DraftError(
      'NO_POOL',
      `No civs remain in ${label} after bans. Remove civ bans or reduce the draft size.`,
    );
  }

  const civTarget = getCiv7CivTarget(req.gameType, groupCount);
  const evenFloor = Math.floor(civPool.length / groupCount);
  const civsPerGroup = Math.max(civTarget, clampAtLeast1(evenFloor));
  const canDealUniqueCivs = civPool.length >= civsPerGroup * groupCount;
  const civGroups = canDealUniqueCivs
    ? dealEvenUniqueGroups([...civPool], Array.from({ length: groupCount }, () => civsPerGroup))
    : Array.from({ length: groupCount }, () => pickDistinct(civPool, civsPerGroup, rng));

  const note = buildRemovedPoolNote({
    leaderRemovedCount: leaderTargets.removedCount,
    civRemovedCount: canDealUniqueCivs ? civPool.length - civsPerGroup * groupCount : undefined,
  });

  return {
    gameVersion: 'civ7',
    gameType: req.gameType,
    startingAge: req.startingAge,
    allocation: {
      groupKind,
      groupCount,
      leadersPerGroup: leaderTargets.perGroup,
      civsPerGroup,
      note,
      bannedLeaders: leaderBans.accepted,
      ignoredLeaderBans: leaderBans.ignored,
      bannedCivs: acceptedCivs,
      ignoredCivBans,
    },
    groups: leaderGroups.map((leaders, index) => ({
      leaders,
      civs: civGroups[index],
    })),
  };
}
