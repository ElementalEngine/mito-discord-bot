import type { CivEdition } from '../../shared/civ.types.js';

export function majorityThreshold(n: number): number {
  return Math.floor(n / 2) + 1;
}

/**
 * Keys banned by a strict majority of ALL voters (the denominator is
 * voterIds.length, not the number of submitters — legacy parity).
 */
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

export type BanSummary = Readonly<{
  leader: ReadonlyMap<string, number>;
  civ: ReadonlyMap<string, number>;
}>;

/** Legacy getSubmittedBanSummary parity over plain inputs. */
export function summarizeSubmittedBans(args: Readonly<{
  edition: CivEdition;
  voterIds: readonly string[];
  submittedVoterIds: ReadonlySet<string>;
  bansByVoter: ReadonlyMap<string, Readonly<{ leaderKeys: readonly string[]; civKeys: readonly string[] }>>;
}>): BanSummary {
  const leader = new Map<string, number>();
  const civ = new Map<string, number>();

  for (const voterId of args.voterIds) {
    if (!args.submittedVoterIds.has(voterId)) continue;
    const bans = args.bansByVoter.get(voterId);
    if (!bans) continue;
    for (const key of bans.leaderKeys) {
      leader.set(key, (leader.get(key) ?? 0) + 1);
    }
    if (args.edition === 'CIV7') {
      for (const key of bans.civKeys) {
        civ.set(key, (civ.get(key) ?? 0) + 1);
      }
    }
  }

  return { leader, civ };
}
