import { randomInt } from 'node:crypto';

import { getDraftLimits } from '../config/draft.config.js';
import type { Civ6LeaderKey, Civ7CivKey, Civ7LeaderKey, CivMeta, LeaderMeta } from '../data/types.js';
import { CIV6_LEADERS } from '../data/civ6.data.js';
import { CIV7_CIVS, CIV7_LEADERS } from '../data/civ7.data.js';
import type {
  Civ6DraftRequest,
  Civ6DraftResult,
  Civ7DraftRequest,
  Civ7DraftResult,
  DraftGameType,
  DraftGroup,
  DraftGroupKind,
} from '../types/draft.js';

export class DraftError extends Error {
  public readonly code: 'VALIDATION' | 'NO_POOL';

  public constructor(code: DraftError['code'], message: string) {
    super(message);
    this.name = 'DraftError';
    this.code = code;
  }
}

const EMOJI_MENTION_RE = /^<a?:([A-Za-z0-9_]{2,32}):(\d{15,22})>$/;
const EMOJI_COLON_RE = /^:([A-Za-z0-9_]{2,64}):$/;
const SNOWFLAKE_RE = /^\d{15,22}$/;

function shuffle<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = randomInt(0, i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function tokenizeBans(raw?: string): string[] {
  if (!raw) return [];
  return raw
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function buildLeaderBanIndex<K extends string>(leaders: Readonly<Record<K, LeaderMeta>>): ReadonlyMap<string, K> {
  const map = new Map<string, K>();
  for (const [key, meta] of Object.entries(leaders) as [K, LeaderMeta][]) {
    map.set(key.toLowerCase(), key);
    map.set(meta.gameId.toLowerCase(), key);
    const emojiId = meta.emojiId?.trim();
    if (emojiId && SNOWFLAKE_RE.test(emojiId)) map.set(emojiId, key);
  }
  return map;
}

function buildCivBanIndex<K extends string>(civs: Readonly<Record<K, CivMeta>>): ReadonlyMap<string, K> {
  const map = new Map<string, K>();
  for (const [key, meta] of Object.entries(civs) as [K, CivMeta][]) {
    map.set(key.toLowerCase(), key);
    map.set(meta.gameId.toLowerCase(), key);
    const emojiId = meta.emojiId?.trim();
    if (emojiId && SNOWFLAKE_RE.test(emojiId)) map.set(emojiId, key);
  }
  return map;
}

type BanResolution<K extends string> = Readonly<{
  banned: ReadonlySet<K>;
  accepted: readonly K[];
  ignored: readonly string[];
}>;

function resolveBansFromTokens<K extends string>(
  tokens: readonly string[],
  index: ReadonlyMap<string, K>,
  label: string,
): BanResolution<K> {
  const banned = new Set<K>();
  const accepted: K[] = [];
  const ignored: string[] = [];

  for (const raw of tokens) {
    const token = raw.trim();
    const mention = EMOJI_MENTION_RE.exec(token);
    const colon = EMOJI_COLON_RE.exec(token);

    const lookupKeys = [mention?.[1], mention?.[2], colon?.[1], token].filter(
      (value): value is string => Boolean(value),
    );

    const resolved = lookupKeys
      .map((value) => index.get(value.toLowerCase()) ?? index.get(value))
      .find((value): value is K => Boolean(value));

    if (!resolved) {
      ignored.push(`${token} (unknown ${label})`);
      continue;
    }

    if (banned.has(resolved)) {
      ignored.push(`${token} (duplicate)`);
      continue;
    }

    banned.add(resolved);
    accepted.push(resolved);
  }

  return { banned, accepted, ignored };
}

function computeLayout(args: Readonly<{
  gameVersion: 'civ6' | 'civ7';
  gameType: DraftGameType;
  numberPlayers?: number;
  numberTeams?: number;
}>): Readonly<{ groupKind: DraftGroupKind; groupCount: number }> {
  const edition = args.gameVersion === 'civ6' ? 'CIV6' : 'CIV7';
  const limits = getDraftLimits(edition);

  if (args.gameType === 'FFA') {
    if (args.numberTeams !== undefined) {
      throw new DraftError('VALIDATION', 'For FFA, use number-players only.');
    }
    const count = args.numberPlayers;
    if (count === undefined) {
      throw new DraftError('VALIDATION', 'For FFA, number-players is required.');
    }
    if (count < limits.FFA.minUsers || count > limits.FFA.maxUsers) {
      throw new DraftError(
        'VALIDATION',
        `For FFA, number-players must be between ${limits.FFA.minUsers} and ${limits.FFA.maxUsers}.`,
      );
    }
    return { groupKind: 'Player', groupCount: count };
  }

  if (args.gameType === 'Teamer') {
    if (args.numberPlayers !== undefined) {
      throw new DraftError('VALIDATION', 'For Teamer, use number-teams only.');
    }
    const teams = args.numberTeams;
    if (teams === undefined) {
      throw new DraftError('VALIDATION', 'For Teamer, number-teams is required.');
    }
    if (teams < limits.Teamer.minTeams || teams > limits.Teamer.maxTeams) {
      throw new DraftError(
        'VALIDATION',
        `For Teamer, number-teams must be between ${limits.Teamer.minTeams} and ${limits.Teamer.maxTeams}.`,
      );
    }
    return { groupKind: 'Team', groupCount: teams };
  }

  if (args.numberPlayers !== undefined || args.numberTeams !== undefined) {
    throw new DraftError('VALIDATION', 'For Duel, do not provide number-players or number-teams.');
  }

  return { groupKind: 'Player', groupCount: limits.Duel.maxUsers };
}

function trimToEqualGroups<T>(
  label: 'leader' | 'civ',
  pool: readonly T[],
  groupCount: number,
): Readonly<{ perGroup: number; usable: readonly T[]; trimmed: number; note?: string }> {
  if (pool.length < groupCount) {
    const plural = label === 'leader' ? 'leaders' : 'civs';
    throw new DraftError(
      'NO_POOL',
      `Not enough ${plural} remain after bans for ${groupCount} groups. Remove bans or reduce the draft size.`,
    );
  }

  const trimmed = pool.length % groupCount;
  const usableCount = pool.length - trimmed;
  const perGroup = usableCount / groupCount;

  if (perGroup < 1) {
    const plural = label === 'leader' ? 'leaders' : 'civs';
    throw new DraftError(
      'NO_POOL',
      `Not enough ${plural} remain after bans for ${groupCount} groups. Remove bans or reduce the draft size.`,
    );
  }

  const shuffled = [...pool];
  shuffle(shuffled);
  const note = trimmed > 0
    ? `${trimmed} ${label}${trimmed === 1 ? '' : 's'} removed from the usable pool to split evenly.`
    : undefined;

  return {
    perGroup,
    usable: shuffled.slice(0, usableCount),
    trimmed,
    note,
  };
}

function splitEvenly<T>(usable: readonly T[], groupCount: number, perGroup: number): T[][] {
  const groups: T[][] = [];
  for (let index = 0; index < groupCount; index += 1) {
    const start = index * perGroup;
    groups.push(usable.slice(start, start + perGroup));
  }
  return groups;
}


export function generateCiv6Draft(req: Civ6DraftRequest): Civ6DraftResult {
  const { groupKind, groupCount } = computeLayout({
    gameVersion: 'civ6',
    gameType: req.gameType,
    numberPlayers: req.numberPlayers,
    numberTeams: req.numberTeams,
  });

  const leaderIndex = buildLeaderBanIndex(CIV6_LEADERS);
  const leaderBans = resolveBansFromTokens(tokenizeBans(req.leaderBansRaw), leaderIndex, 'leader');
  const leaderPool = (Object.keys(CIV6_LEADERS) as Civ6LeaderKey[]).filter(
    (key) => !leaderBans.banned.has(key),
  );
  const leaderGroups = trimToEqualGroups('leader', leaderPool, groupCount);
  const groups = splitEvenly(leaderGroups.usable, groupCount, leaderGroups.perGroup).map(
    (leaders) => ({ leaders }),
  );

  return {
    gameVersion: 'civ6',
    gameType: req.gameType,
    allocation: {
      groupKind,
      groupCount,
      leadersPerGroup: leaderGroups.perGroup,
      trimmedLeaders: leaderGroups.trimmed,
      bannedLeaders: leaderBans.accepted,
      ignoredLeaderBans: leaderBans.ignored,
    },
    groups,
  };
}

export function generateCiv7Draft(req: Civ7DraftRequest): Civ7DraftResult {
  const { groupKind, groupCount } = computeLayout({
    gameVersion: 'civ7',
    gameType: req.gameType,
    numberPlayers: req.numberPlayers,
    numberTeams: req.numberTeams,
  });

  const leaderIndex = buildLeaderBanIndex(CIV7_LEADERS);
  const civIndex = buildCivBanIndex(CIV7_CIVS);
  const leaderBans = resolveBansFromTokens(tokenizeBans(req.leaderBansRaw), leaderIndex, 'leader');
  const civBans = resolveBansFromTokens(tokenizeBans(req.civBansRaw), civIndex, 'civ');
  const allowAllAges = req.startingAge === 'None';

  const leaderPool = (Object.keys(CIV7_LEADERS) as Civ7LeaderKey[]).filter(
    (key) => !leaderBans.banned.has(key),
  );
  const civPool = (Object.entries(CIV7_CIVS) as [Civ7CivKey, CivMeta][])
    .filter(([key, meta]) => !civBans.banned.has(key) && (allowAllAges || meta.agePool === req.startingAge))
    .map(([key]) => key);

  if (civPool.length === 0) {
    const label = allowAllAges ? 'all ages' : String(req.startingAge);
    throw new DraftError('NO_POOL', `No civs remain for ${label} after bans.`);
  }

  const leaderGroups = trimToEqualGroups('leader', leaderPool, groupCount);
  const civGroups = trimToEqualGroups('civ', civPool, groupCount);
  const leaders = splitEvenly(leaderGroups.usable, groupCount, leaderGroups.perGroup);
  const civs = splitEvenly(civGroups.usable, groupCount, civGroups.perGroup);

  const groups: DraftGroup[] = leaders.map((groupLeaders, index) => ({
    leaders: groupLeaders,
    civs: civs[index],
  }));

  return {
    gameVersion: 'civ7',
    gameType: req.gameType,
    startingAge: req.startingAge,
    allocation: {
      groupKind,
      groupCount,
      leadersPerGroup: leaderGroups.perGroup,
      civsPerGroup: civGroups.perGroup,
      trimmedLeaders: leaderGroups.trimmed,
      trimmedCivs: civGroups.trimmed,
      bannedLeaders: leaderBans.accepted,
      ignoredLeaderBans: leaderBans.ignored,
      bannedCivs: civBans.accepted,
      ignoredCivBans: civBans.ignored,
    },
    groups,
  };
}
