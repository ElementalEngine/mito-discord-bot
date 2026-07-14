import { CIV6_LEADERS } from '../../data/civ6.data.js';
import { CIV7_CIVS, CIV7_LEADERS } from '../../data/civ7.data.js';
import type { Civ6LeaderKey, Civ7CivKey, Civ7LeaderKey, CivMeta, LeaderMeta } from '../../data/types.js';
import type { CivEdition } from '../../shared/civ.types.js';

const EMOJI_MENTION_RE = /^<a?:([A-Za-z0-9_]{2,32}):(\d{15,22})>$/;
const EMOJI_COLON_RE = /^:([A-Za-z0-9_]{2,32}):$/;
const SNOWFLAKE_RE = /^\d{15,22}$/;

export type BanResolution<K extends string> = Readonly<{
  banned: ReadonlySet<K>;
  accepted: readonly K[];
  ignored: readonly string[];
}>;

export function tokenizeBans(raw?: string): string[] {
  if (!raw) return [];
  return raw
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function buildLeaderBanIndex<K extends string>(
  leaders: Readonly<Record<K, LeaderMeta>>,
): ReadonlyMap<string, K> {
  const map = new Map<string, K>();
  for (const [key, meta] of Object.entries(leaders) as [K, LeaderMeta][]) {
    map.set(key.toLowerCase(), key);
    map.set(meta.gameId.toLowerCase(), key);
    const emojiId = meta.emojiId?.trim();
    if (emojiId && SNOWFLAKE_RE.test(emojiId)) {
      map.set(emojiId, key);
    }
  }
  return map;
}

export function buildCivBanIndex<K extends string>(
  civs: Readonly<Record<K, CivMeta>>,
): ReadonlyMap<string, K> {
  const map = new Map<string, K>();
  for (const [key, meta] of Object.entries(civs) as [K, CivMeta][]) {
    map.set(key.toLowerCase(), key);
    map.set(meta.gameId.toLowerCase(), key);
    const emojiId = meta.emojiId?.trim();
    if (emojiId && SNOWFLAKE_RE.test(emojiId)) {
      map.set(emojiId, key);
    }
  }
  return map;
}

export function resolveEmojiBans<K extends string>(
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

    const name = mention?.[1] ?? colon?.[1] ?? null;
    const id = mention?.[2] ?? null;

    if (!name) {
      ignored.push(`${token} (invalid ${label} emoji)`);
      continue;
    }

    const key = index.get(name.toLowerCase()) ?? (id ? index.get(id) : undefined);

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

export function getAvailableCiv6LeaderKeys(banned: ReadonlySet<Civ6LeaderKey>): Civ6LeaderKey[] {
  return (Object.keys(CIV6_LEADERS) as Civ6LeaderKey[]).filter((key) => !banned.has(key));
}

export function getAvailableCiv7LeaderKeys(banned: ReadonlySet<Civ7LeaderKey>): Civ7LeaderKey[] {
  return (Object.keys(CIV7_LEADERS) as Civ7LeaderKey[]).filter((key) => !banned.has(key));
}

export function getAvailableCiv7CivKeys(args: Readonly<{
  startingAge: string;
  banned: ReadonlySet<Civ7CivKey>;
}>): Civ7CivKey[] {
  const allowAllAges = args.startingAge === 'None';
  return (Object.entries(CIV7_CIVS) as [Civ7CivKey, CivMeta][])
    .filter(([key, meta]) => (allowAllAges || meta.agePool === args.startingAge) && !args.banned.has(key))
    .map(([key]) => key);
}

/** Leader pool from pre-resolved ban keys (legacy buildVoteLeaderPool parity). */
export function buildKeyedLeaderPool(args: Readonly<{
  edition: CivEdition;
  bannedLeaderKeys: readonly string[];
}>): string[] {
  const banned = new Set(args.bannedLeaderKeys);
  return args.edition === 'CIV6'
    ? getAvailableCiv6LeaderKeys(banned as ReadonlySet<Civ6LeaderKey>)
    : getAvailableCiv7LeaderKeys(banned as ReadonlySet<Civ7LeaderKey>);
}

/** Civ pool from pre-resolved ban keys (legacy buildVoteCivPool parity). */
export function buildKeyedCivPool(args: Readonly<{
  edition: CivEdition;
  startingAge?: string;
  bannedCivKeys: readonly string[];
}>): string[] {
  if (args.edition !== 'CIV7') return [];
  const banned = new Set(args.bannedCivKeys);
  return getAvailableCiv7CivKeys({
    startingAge: args.startingAge ?? 'Antiquity_Age',
    banned: banned as ReadonlySet<Civ7CivKey>,
  });
}
