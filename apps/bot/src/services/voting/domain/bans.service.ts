import type { GameVoteSession } from '../../../types/voting.types.js';

function majorityThreshold(n: number): number {
  return Math.floor(n / 2) + 1;
}

export function getSubmittedBanSummary(
  v: GameVoteSession
): Readonly<{
  leader: ReadonlyMap<string, number>;
  civ: ReadonlyMap<string, number>;
}> {
  const leader = new Map<string, number>();
  const civ = new Map<string, number>();

  for (const voterId of v.voterIds) {
    if (!v.bansSubmitted.has(voterId)) continue;
    const bans = v.bansByVoter.get(voterId);
    if (!bans) continue;
    for (const key of bans.leaderKeys) {
      leader.set(key, (leader.get(key) ?? 0) + 1);
    }
    if (v.edition === 'CIV7') {
      for (const key of bans.civKeys) {
        civ.set(key, (civ.get(key) ?? 0) + 1);
      }
    }
  }

  return { leader, civ };
}

export function majorityBans<K extends string>(
  voterIds: readonly string[],
  perVoter: ReadonlyMap<string, ReadonlySet<K>>
): readonly K[] {
  const need = majorityThreshold(voterIds.length);
  const counts = new Map<K, number>();

  for (const id of voterIds) {
    const set = perVoter.get(id);
    if (!set) continue;
    for (const key of set) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }

  const out: K[] = [];
  for (const [key, count] of counts) {
    if (count >= need) out.push(key);
  }
  return out;
}
