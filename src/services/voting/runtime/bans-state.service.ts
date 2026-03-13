import { getGameVoteBanLimits } from '../../../config/draft.config.js';
import type { BanSubmission, GameVoteSession } from '../../../types/voting.types.js';

function getEmptyBans(): BanSubmission {
  return { leaderKeys: [], civKeys: [] };
}

function cloneBanSubmission(bans: BanSubmission): BanSubmission {
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

function normalizeBanSubmission(v: GameVoteSession, bans: BanSubmission): BanSubmission {
  const limits = getBanLimits(v);
  return {
    leaderKeys: dedupeStable(bans.leaderKeys).slice(0, limits.leader),
    civKeys: dedupeStable(bans.civKeys).slice(0, limits.civ),
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
