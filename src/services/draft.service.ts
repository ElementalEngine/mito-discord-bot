import { randomInt } from 'node:crypto';

import type { CivMeta, LeaderMeta, LeaderType } from '../data/index.js';
import { CIV6_LEADERS } from '../data/civ6-data.js';
import { CIV7_CIVS, CIV7_LEADERS } from '../data/civ7-data.js';
import type {
  Civ6DraftRequest,
  Civ6DraftResult,
  Civ7DraftRequest,
  Civ7DraftResult,
  DraftAllocation,
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

const MAX_CIV6_PLAYERS = 14;
const MAX_CIV7_PLAYERS = 10;
const MAX_CIV6_TEAMS = 7;
const MAX_CIV7_TEAMS = 5;

const FFA_MAX_LEADERS_PER_PLAYER = 6;
const DUEL_LEADERS_PER_PLAYER = 6;

const CIV7_FFA_CIVS_PER_PLAYER = 4;
const CIV7_DUEL_CIVS_PER_PLAYER = 4;

const LEADER_TYPES: readonly LeaderType[] = [
  'Industrial',
  'War',
  'Naval',
  'Culture',
  'Religious',
  'Science',
  'None',
];

type Civ6LeaderKey = keyof typeof CIV6_LEADERS;
type Civ7LeaderKey = keyof typeof CIV7_LEADERS;
type Civ7CivKey = keyof typeof CIV7_CIVS;

// Capture name + id. We resolve bans by emoji name (matches meta.gameId) because server emoji IDs may differ.
const EMOJI_MENTION_RE = /^<a?:([A-Za-z0-9_]{2,32}):(\d{15,22})>$/;
const EMOJI_COLON_RE = /^:([A-Za-z0-9_]{2,32}):$/;
const SNOWFLAKE_RE = /^\d{15,22}$/;

function shuffle<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
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

function buildLeaderBanIndex<K extends string>(
  leaders: Readonly<Record<K, LeaderMeta>>
): ReadonlyMap<string, K> {
  const map = new Map<string, K>();
  for (const [key, meta] of Object.entries(leaders) as [K, LeaderMeta][]) {
    map.set(key.toLowerCase(), key);
    map.set(meta.gameId.toLowerCase(), key);
    const emojiId = meta.emojiId?.trim();
    if (emojiId && SNOWFLAKE_RE.test(emojiId)) map.set(emojiId, key);
  }
  return map;
}

function buildCivBanIndex<K extends string>(
  civs: Readonly<Record<K, CivMeta>>
): ReadonlyMap<string, K> {
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

function resolveEmojiBans<K extends string>(
  tokens: readonly string[],
  index: ReadonlyMap<string, K>,
  label: string
): BanResolution<K> {
  const banned = new Set<K>();
  const accepted: K[] = [];
  const ignored: string[] = [];

  for (const raw of tokens) {
    const token = raw.trim();
    const mention = EMOJI_MENTION_RE.exec(token);
    const colon = EMOJI_COLON_RE.exec(token);

    const name = mention?.[1] ?? colon?.[1] ?? null;
    const id = mention?.[2] ?? null;

    if (!name) {
      ignored.push(`${token} (invalid ${label} emoji)`);
      continue;
    }

    const key =
      index.get(name.toLowerCase()) ??
      (id ? index.get(id) : undefined);

    if (!key) {
      ignored.push(`${name} (unknown ${label})`);
      continue;
    }

    if (banned.has(key)) {
      ignored.push(`${name} (duplicate)`);
      continue;
    }

    banned.add(key);
    accepted.push(key);
  }

  return { banned, accepted, ignored };
}

function computeLayout(args: Readonly<{
  gameVersion: 'civ6' | 'civ7';
  gameType: DraftGameType;
  numberPlayers?: number;
  numberTeams?: number;
}>): Readonly<{ groupKind: DraftGroupKind; groupCount: number }> {
  const { gameVersion, gameType, numberPlayers, numberTeams } = args;

  const maxPlayers = gameVersion === 'civ6' ? MAX_CIV6_PLAYERS : MAX_CIV7_PLAYERS;
  const maxTeams = gameVersion === 'civ6' ? MAX_CIV6_TEAMS : MAX_CIV7_TEAMS;

  if (gameType === 'FFA') {
    if (numberTeams !== undefined) {
      throw new DraftError(
        'VALIDATION',
        'For FFA, use number-players (do not provide number-teams).'
      );
    }
    if (numberPlayers === undefined) {
      throw new DraftError('VALIDATION', 'For FFA, number-players is required.');
    }
    if (numberPlayers < 2 || numberPlayers > maxPlayers) {
      throw new DraftError(
        'VALIDATION',
        `For FFA, number-players must be between 2 and ${maxPlayers}.`
      );
    }
    return { groupKind: 'Player', groupCount: numberPlayers };
  }

  if (gameType === 'Teamer') {
    if (numberPlayers !== undefined) {
      throw new DraftError(
        'VALIDATION',
        'For Teamer, use number-teams (do not provide number-players).'
      );
    }
    if (numberTeams === undefined) {
      throw new DraftError('VALIDATION', 'For Teamer, number-teams is required.');
    }
    if (numberTeams < 2 || numberTeams > maxTeams) {
      throw new DraftError(
        'VALIDATION',
        `For Teamer, number-teams must be between 2 and ${maxTeams}.`
      );
    }
    return { groupKind: 'Team', groupCount: numberTeams };
  }

  // Duel
  if (numberPlayers !== undefined || numberTeams !== undefined) {
    throw new DraftError(
      'VALIDATION',
      'For Duel, do not provide number-players or number-teams.'
    );
  }
  return { groupKind: 'Player', groupCount: 2 };
}

function dealUnique(pool: string[], count: number): string[] {
  return pool.splice(0, count);
}

function pickDistinct<T>(pool: readonly T[], count: number): T[] {
  if (count <= 0) return [];
  const copy = pool.slice();
  shuffle(copy);
  return copy.slice(0, count);
}

function clampAtLeast1(n: number): number {
  return n < 1 ? 1 : n;
}

function teamTargetCiv6(teams: number): number {
  if (teams === 2) return 20;
  if (teams >= 3 && teams <= 6) return 10;
  // 7 teams
  return 6;
}

function teamTargetCiv7Leaders(teams: number): number {
  if (teams === 2) return 10;
  if (teams === 3) return 6;
  if (teams === 4) return 6;
  return 5;
}

function teamTargetCiv7Civs(teams: number): number {
  if (teams === 2) return 7;
  if (teams === 3) return 5;
  if (teams === 4) return 5;
  return 4;
}

function noteReduced(args: Readonly<{ label: string; from: number; to: number }>): string {
  return `${args.label} reduced from ${args.from} to ${args.to} due to bans/pool size.`;
}

function computeLeadersPerGroup(args: Readonly<{
  gameVersion: 'civ6' | 'civ7';
  gameType: DraftGameType;
  groupCount: number;
  remainingLeaderCount: number;
}>): Readonly<{ leadersPerGroup: number; note?: string }> {
  const { gameVersion, gameType, groupCount, remainingLeaderCount } = args;

  if (gameType === 'Duel') {
    const required = DUEL_LEADERS_PER_PLAYER * groupCount;
    if (remainingLeaderCount < required) {
      throw new DraftError(
        'NO_POOL',
        `Not enough leaders after bans for Duel. Need ${required} but have ${remainingLeaderCount}.`
      );
    }
    return { leadersPerGroup: DUEL_LEADERS_PER_PLAYER };
  }

  if (gameType === 'FFA') {
    const computed = Math.floor(remainingLeaderCount / groupCount);
    const leadersPerGroup = Math.min(FFA_MAX_LEADERS_PER_PLAYER, computed);
    if (leadersPerGroup < 1) {
      throw new DraftError(
        'NO_POOL',
        `Not enough leaders for ${groupCount} players after bans. Remove bans or reduce players.`
      );
    }

    const note =
      leadersPerGroup < FFA_MAX_LEADERS_PER_PLAYER
        ? `Leaders: ${leadersPerGroup} each due to pool size/bans.`
        : undefined;
    return { leadersPerGroup, note };
  }

  // Teamer
  const target =
    gameVersion === 'civ6' ? teamTargetCiv6(groupCount) : teamTargetCiv7Leaders(groupCount);
  const maxPossible = Math.floor(remainingLeaderCount / groupCount);
  const leadersPerGroup = Math.min(target, maxPossible);
  if (leadersPerGroup < 1) {
    throw new DraftError(
      'NO_POOL',
      `Not enough leaders for ${groupCount} teams after bans. Remove bans or reduce teams.`
    );
  }
  const note = leadersPerGroup < target ? noteReduced({ label: 'Leaders', from: target, to: leadersPerGroup }) : undefined;
  return { leadersPerGroup, note };
}

function buildAllocationNote(notes: readonly (string | undefined)[]): string | undefined {
  const parts = notes.filter((n): n is string => Boolean(n));
  return parts.length ? parts.join(' ') : undefined;
}

function dealCiv6LeadersByType(args: Readonly<{
  availableKeys: readonly Civ6LeaderKey[];
  leadersPerGroup: number;
  groupCount: number;
}>): DraftGroup[] {
  const { availableKeys, leadersPerGroup, groupCount } = args;

  const buckets = new Map<LeaderType, Civ6LeaderKey[]>();
  for (const t of LEADER_TYPES) buckets.set(t, []);

  for (const k of availableKeys) {
    const meta = CIV6_LEADERS[k];
    const t = meta?.type ?? 'None';
    (buckets.get(t) ?? buckets.get('None')!).push(k);
  }

  for (const arr of buckets.values()) shuffle(arr);

  const groups: DraftGroup[] = Array.from({ length: groupCount }, () => ({ leaders: [] }));
  const types = LEADER_TYPES;
  const typeCount = types.length;

  for (let g = 0; g < groupCount; g++) {
    const picks: Civ6LeaderKey[] = [];
    let cursor = g % typeCount;
    for (let i = 0; i < leadersPerGroup; i++) {
      let chosen: Civ6LeaderKey | undefined;
      for (let step = 0; step < typeCount; step++) {
        const t = types[(cursor + step) % typeCount];
        const arr = buckets.get(t);
        const v = arr?.pop();
        if (v) {
          chosen = v;
          cursor = (cursor + step + 1) % typeCount;
          break;
        }
      }
      if (!chosen) {
        throw new DraftError(
          'NO_POOL',
          'Not enough leaders remaining to complete the draft. Remove bans or reduce players/teams.'
        );
      }
      picks.push(chosen);
    }
    groups[g] = { leaders: picks };
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
  const leaderBans = resolveEmojiBans(tokenizeBans(req.leaderBansRaw), leaderIndex, 'leader');
  const banned = leaderBans.banned;

  const allLeaderKeys = Object.keys(CIV6_LEADERS) as Civ6LeaderKey[];
  const available = allLeaderKeys.filter((k) => !banned.has(k));

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

export function generateCiv7Draft(req: Civ7DraftRequest): Civ7DraftResult {
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

  const bannedLeaders = leaderBans.banned;

  // Civ bans are only applied within the selected age pool.
  const bannedCivs = new Set<Civ7CivKey>();
  const acceptedCivs: Civ7CivKey[] = [];
  const ignoredCivBans: string[] = [...civBansAll.ignored];
  for (const key of civBansAll.accepted) {
    const meta = CIV7_CIVS[key];
    if (meta.agePool !== req.startingAge) {
      ignoredCivBans.push(`${meta.gameId} (not in ${req.startingAge})`);
      continue;
    }
    bannedCivs.add(key);
    acceptedCivs.push(key);
  }

  const allLeaderKeys = Object.keys(CIV7_LEADERS) as Civ7LeaderKey[];
  const leaderPool = allLeaderKeys.filter((k) => !bannedLeaders.has(k));

  const leaderSizing = computeLeadersPerGroup({
    gameVersion: 'civ7',
    gameType: req.gameType,
    groupCount,
    remainingLeaderCount: leaderPool.length,
  });

  const civPool = (Object.entries(CIV7_CIVS) as [Civ7CivKey, CivMeta][]) 
    .filter(([key, meta]) => meta.agePool === req.startingAge && !bannedCivs.has(key))
    .map(([key]) => key);

  if (civPool.length < 1) {
    throw new DraftError(
      'NO_POOL',
      `No civs available for ${req.startingAge} after bans. Remove civ bans or pick a different age.`
    );
  }

  let civTarget: number;
  if (req.gameType === 'Duel') civTarget = CIV7_DUEL_CIVS_PER_PLAYER;
  else if (req.gameType === 'FFA') civTarget = CIV7_FFA_CIVS_PER_PLAYER;
  else civTarget = teamTargetCiv7Civs(groupCount);

  // Civs may duplicate across groups, but we keep them distinct within a group.
  const civsPerGroup = clampAtLeast1(Math.min(civTarget, civPool.length));

  const allocationNote = buildAllocationNote([
    leaderSizing.note,
    civsPerGroup < civTarget ? noteReduced({ label: 'Civs', from: civTarget, to: civsPerGroup }) : undefined,
  ]);

  shuffle(leaderPool);
  const groups: DraftGroup[] = [];

  // Leaders are always globally unique.
  const leadersPerGroup = leaderSizing.leadersPerGroup;
  for (let i = 0; i < groupCount; i++) {
    const leaders = dealUnique(leaderPool, leadersPerGroup);
    groups.push({ leaders, civs: [] });
  }

  // Civs: duplicate across groups allowed, but avoid duplication in Duel when possible.
  if (req.gameType === 'Duel' && civPool.length >= civsPerGroup * 2) {
    const copy = civPool.slice();
    shuffle(copy);
    groups[0] = { leaders: groups[0].leaders, civs: dealUnique(copy, civsPerGroup) };
    groups[1] = { leaders: groups[1].leaders, civs: dealUnique(copy, civsPerGroup) };
  } else {
    for (let i = 0; i < groupCount; i++) {
      groups[i] = { leaders: groups[i].leaders, civs: pickDistinct(civPool, civsPerGroup) };
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
