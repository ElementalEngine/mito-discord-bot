import { CIV6_LEADERS } from '../../../data/civ6.data.js';
import { CIV7_CIVS, CIV7_LEADERS } from '../../../data/civ7.data.js';
import type { CivMeta, LeaderMeta } from '../../../data/types.js';
import type { GameVoteSession } from '../../../types/voting.types.js';
import type { CivEdition } from '../../../config/types.js';
import { humanizeGameId } from '../../../utils/humanize-game-id.js';
import { humanizeDraftKey, sanitizeEmojiName } from '../../drafting/domain/labels.service.js';

const CUSTOM_EMOJI_RE = /^<a?:([A-Za-z0-9_]{2,32}):(\d{15,22})>$/;
const COLON_EMOJI_RE = /^:([A-Za-z0-9_]{2,32}):$/;
const GLOBAL_EMOJI_RE = /<a?:([A-Za-z0-9_]{2,32}):(\d{15,22})>|:([A-Za-z0-9_]{2,32}):/g;
const KEY_PREFIX_RE = /^(leader|civilization)_/;

type BanMeta = Readonly<{ gameId: string; emojiId?: string }>;

export type BanEntityKind = 'leader' | 'civ';

type BanLookupResult = Readonly<{
  keys: readonly string[];
  unknownTokens: readonly string[];
  ambiguousTokens: readonly string[];
}>;

function normalizeLookupKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^:+|:+$/g, '')
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function addIndexAlias(index: Map<string, Set<string>>, rawAlias: string, key: string): void {
  const alias = normalizeLookupKey(rawAlias);
  if (!alias) return;

  let bucket = index.get(alias);
  if (!bucket) {
    bucket = new Set<string>();
    index.set(alias, bucket);
  }
  bucket.add(key);
}

function buildIndex<T extends string>(source: Readonly<Record<T, BanMeta>>): ReadonlyMap<string, ReadonlySet<string>> {
  const index = new Map<string, Set<string>>();

  for (const [key, meta] of Object.entries(source) as [T, BanMeta][]) {
    addIndexAlias(index, key, key);
    addIndexAlias(index, key.replace(KEY_PREFIX_RE, ''), key);
    addIndexAlias(index, humanizeDraftKey(key), key);

    addIndexAlias(index, meta.gameId, key);
    addIndexAlias(index, humanizeGameId(meta.gameId), key);
    addIndexAlias(index, sanitizeEmojiName(meta.gameId), key);
  }

  return index;
}

const CIV6_LEADER_INDEX = buildIndex(CIV6_LEADERS as Readonly<Record<string, LeaderMeta>>);
const CIV7_LEADER_INDEX = buildIndex(CIV7_LEADERS as Readonly<Record<string, LeaderMeta>>);
const CIV7_CIV_INDEX = buildIndex(CIV7_CIVS as Readonly<Record<string, CivMeta>>);

function getIndexForEdition(
  edition: CivEdition,
  kind: BanEntityKind,
): ReadonlyMap<string, ReadonlySet<string>> | null {
  if (kind === 'leader') {
    return edition === 'CIV6' ? CIV6_LEADER_INDEX : CIV7_LEADER_INDEX;
  }

  if (edition !== 'CIV7') return null;
  return CIV7_CIV_INDEX;
}

function tokenizeBanInput(raw: string): string[] {
  const chunks = raw
    .split(/[\n,]+/)
    .map((token) => token.trim())
    .filter(Boolean);

  const tokens: string[] = [];
  for (const chunk of chunks) {
    const matches = [...chunk.matchAll(GLOBAL_EMOJI_RE)];
    if (matches.length > 0) {
      const remainder = chunk.replace(GLOBAL_EMOJI_RE, '').trim();
      if (!remainder) {
        for (const match of matches) {
          tokens.push(match[0]);
        }
        continue;
      }
    }

    tokens.push(chunk);
  }

  return tokens;
}

function resolveLookupCandidates(token: string): readonly string[] {
  const customEmoji = CUSTOM_EMOJI_RE.exec(token);
  if (customEmoji) {
    return [normalizeLookupKey(customEmoji[1])];
  }

  const colonEmoji = COLON_EMOJI_RE.exec(token);
  if (colonEmoji) {
    return [normalizeLookupKey(colonEmoji[1])];
  }

  const normalized = normalizeLookupKey(token);
  if (!normalized) return [];

  const variants = new Set<string>([normalized]);
  variants.add(normalized.replace(KEY_PREFIX_RE, ''));
  variants.add(normalized.replace(/_+/g, ''));
  return [...variants].filter(Boolean);
}

function resolveTokens(
  tokens: readonly string[],
  index: ReadonlyMap<string, ReadonlySet<string>>,
): BanLookupResult {
  const resolved = new Set<string>();
  const unknownTokens: string[] = [];
  const ambiguousTokens: string[] = [];

  for (const token of tokens) {
    const candidates = resolveLookupCandidates(token);
    if (candidates.length === 0) {
      unknownTokens.push(token);
      continue;
    }

    const matched = new Set<string>();
    for (const candidate of candidates) {
      const keys = index.get(candidate);
      if (!keys) continue;
      for (const key of keys) matched.add(key);
    }

    if (matched.size === 0) {
      unknownTokens.push(token);
      continue;
    }

    if (matched.size > 1) {
      ambiguousTokens.push(token);
      continue;
    }

    resolved.add([...matched][0]);
  }

  return {
    keys: [...resolved],
    unknownTokens,
    ambiguousTokens,
  };
}

export function resolveTypedBanInputForEdition(
  edition: CivEdition,
  kind: BanEntityKind,
  raw: string,
): BanLookupResult {
  const index = getIndexForEdition(edition, kind);
  if (!index) {
    return { keys: [], unknownTokens: [], ambiguousTokens: [] };
  }

  return resolveTokens(tokenizeBanInput(raw), index);
}

export function resolveTypedBanInput(
  session: GameVoteSession,
  kind: BanEntityKind,
  raw: string,
): BanLookupResult {
  return resolveTypedBanInputForEdition(session.edition, kind, raw);
}

export function formatBanInputIssues(
  unknownTokens: readonly string[],
  ambiguousTokens: readonly string[],
): string | null {
  const parts: string[] = [];
  if (unknownTokens.length > 0) {
    parts.push(`Unknown: ${unknownTokens.map((token) => `\`${token}\``).join(', ')}`);
  }
  if (ambiguousTokens.length > 0) {
    parts.push(`Ambiguous: ${ambiguousTokens.map((token) => `\`${token}\``).join(', ')}`);
  }
  return parts.length > 0 ? parts.join('\n') : null;
}
