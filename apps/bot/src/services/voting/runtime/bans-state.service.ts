import { getGameVoteBanLimits } from '../../../config/draft.config.js';
import type { BanSearchState, BanSubmission, GameVoteSession } from '../../../types/voting.types.js';

export function getEmptyBans(): BanSubmission {
  return { leaderKeys: [], civKeys: [] };
}

export function cloneBanSubmission(bans: BanSubmission): BanSubmission {
  return { leaderKeys: [...bans.leaderKeys], civKeys: [...bans.civKeys] };
}

function dedupeStable(keys: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const key of keys) {
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

function getBanLimits(v: GameVoteSession): Readonly<{ leader: number; civ: number }> {
  return getGameVoteBanLimits(v.edition, v.startingAge);
}

function excludeHostBans(v: GameVoteSession, bans: BanSubmission): BanSubmission {
  const hostLeaderBanKeys = new Set(v.hostLeaderBanKeys);
  const hostCivBanKeys = new Set(v.hostCivBanKeys);

  return {
    leaderKeys: bans.leaderKeys.filter((key) => !hostLeaderBanKeys.has(key)),
    civKeys: bans.civKeys.filter((key) => !hostCivBanKeys.has(key)),
  };
}

export function normalizeBanSubmission(v: GameVoteSession, bans: BanSubmission): BanSubmission {
  const limits = getBanLimits(v);
  const filtered = excludeHostBans(v, bans);
  return {
    leaderKeys: dedupeStable(filtered.leaderKeys).slice(0, limits.leader),
    civKeys: dedupeStable(filtered.civKeys).slice(0, limits.civ),
  };
}

function banSubmissionEquals(a: BanSubmission, b: BanSubmission): boolean {
  return a.leaderKeys.length === b.leaderKeys.length
    && a.civKeys.length === b.civKeys.length
    && a.leaderKeys.every((key, idx) => key === b.leaderKeys[idx])
    && a.civKeys.every((key, idx) => key === b.civKeys[idx]);
}

export function ensureStagedBans(v: GameVoteSession, voterId: string): BanSubmission {
  const existing = v.stagedBansByVoter.get(voterId);
  if (existing) return existing;
  const created = normalizeBanSubmission(v, cloneBanSubmission(v.bansByVoter.get(voterId) ?? getEmptyBans()));
  v.stagedBansByVoter.set(voterId, created);
  return created;
}

export function hasStagedBanChanges(v: GameVoteSession, voterId: string): boolean {
  return !banSubmissionEquals(ensureStagedBans(v, voterId), v.bansByVoter.get(voterId) ?? getEmptyBans());
}

export function getBanPageState(v: GameVoteSession, voterId: string): { leaderPage: number; civPage: number } {
  return v.banPages.get(voterId) ?? { leaderPage: 0, civPage: 0 };
}

export function setBanPageState(
  v: GameVoteSession,
  voterId: string,
  next: Readonly<{ leaderPage: number; civPage: number }>,
): void {
  v.banPages.set(voterId, { leaderPage: next.leaderPage, civPage: next.civPage });
}

export function mergePagedBanSelection(
  currentKeys: readonly string[],
  pageKeys: readonly string[],
  selectedKeys: readonly string[],
): string[] {
  const pageSet = new Set(pageKeys);
  const out = currentKeys.filter((key) => !pageSet.has(key));
  out.push(...selectedKeys);
  return dedupeStable(out);
}


export function getBanSearchState(v: GameVoteSession, voterId: string): BanSearchState {
  return v.banSearches.get(voterId) ?? {};
}

export function setBanSearchQuery(
  v: GameVoteSession,
  voterId: string,
  banType: 'leader' | 'civ',
  rawQuery: string,
): void {
  const query = rawQuery.trim();
  const current = getBanSearchState(v, voterId);
  const next: { leaderQuery?: string; civQuery?: string } = { ...current };
  if (banType === 'leader') {
    if (query) next.leaderQuery = query;
    else delete next.leaderQuery;
  } else {
    if (query) next.civQuery = query;
    else delete next.civQuery;
  }
  if (!next.leaderQuery && !next.civQuery) {
    v.banSearches.delete(voterId);
    return;
  }
  v.banSearches.set(voterId, next);
}
