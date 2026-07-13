import type { LeaderType } from '../../data/types.js';
import type { DraftGameType } from '../../shared/draft.types.js';
import { DraftError } from './errors.js';

export const LEGACY_FFA_MAX_LEADERS_PER_PLAYER = 6;
export const LEGACY_DUEL_LEADERS_PER_PLAYER = 6;
export const LEGACY_CIV7_FFA_CIVS_PER_PLAYER = 4;
export const LEGACY_CIV7_DUEL_CIVS_PER_PLAYER = 4;

export const LEADER_TYPES: readonly LeaderType[] = [
  'Industrial',
  'War',
  'Naval',
  'Culture',
  'Religious',
  'Science',
  'None',
];

function teamTargetCiv6(teams: number): number {
  if (teams === 2) return 20;
  if (teams >= 3 && teams <= 6) return 10;
  return 6;
}

function teamTargetCiv7Leaders(teams: number): number {
  if (teams === 2) return 10;
  if (teams === 3 || teams === 4) return 6;
  return 5;
}

function teamTargetCiv7Civs(teams: number): number {
  if (teams === 2) return 7;
  if (teams === 3 || teams === 4) return 5;
  return 4;
}

function noteReduced(args: Readonly<{ label: string; from: number; to: number }>): string {
  return `${args.label} reduced from ${args.from} to ${args.to} due to bans/pool size.`;
}

export function computeLeadersPerGroup(args: Readonly<{
  gameVersion: 'civ6' | 'civ7';
  gameType: DraftGameType;
  groupCount: number;
  remainingLeaderCount: number;
}>): Readonly<{ leadersPerGroup: number; note?: string }> {
  const { gameVersion, gameType, groupCount, remainingLeaderCount } = args;

  if (gameType === 'Duel') {
    const required = LEGACY_DUEL_LEADERS_PER_PLAYER * groupCount;
    if (remainingLeaderCount < required) {
      throw new DraftError(
        'NO_POOL',
        `Not enough leaders after bans for Duel. Need ${required} but have ${remainingLeaderCount}.`,
      );
    }
    return { leadersPerGroup: LEGACY_DUEL_LEADERS_PER_PLAYER };
  }

  if (gameType === 'FFA') {
    const computed = Math.floor(remainingLeaderCount / groupCount);
    const leadersPerGroup = Math.min(LEGACY_FFA_MAX_LEADERS_PER_PLAYER, computed);
    if (leadersPerGroup < 1) {
      throw new DraftError(
        'NO_POOL',
        `Not enough leaders for ${groupCount} players after bans. Remove bans or reduce players.`,
      );
    }

    const note =
      leadersPerGroup < LEGACY_FFA_MAX_LEADERS_PER_PLAYER
        ? `Leaders: ${leadersPerGroup} each due to pool size/bans.`
        : undefined;
    return { leadersPerGroup, note };
  }

  const target = gameVersion === 'civ6' ? teamTargetCiv6(groupCount) : teamTargetCiv7Leaders(groupCount);
  const maxPossible = Math.floor(remainingLeaderCount / groupCount);
  const leadersPerGroup = Math.min(target, maxPossible);

  if (leadersPerGroup < 1) {
    throw new DraftError(
      'NO_POOL',
      `Not enough leaders for ${groupCount} teams after bans. Remove bans or reduce teams.`,
    );
  }
  const note = leadersPerGroup < target ? noteReduced({ label: 'Leaders', from: target, to: leadersPerGroup }) : undefined;
  return { leadersPerGroup, note };
}

export function getCiv7CivTarget(gameType: DraftGameType, groupCount: number): number {
  if (gameType === 'Duel') return LEGACY_CIV7_DUEL_CIVS_PER_PLAYER;
  if (gameType === 'FFA') return LEGACY_CIV7_FFA_CIVS_PER_PLAYER;
  return teamTargetCiv7Civs(groupCount);
}

export function buildAllocationNote(notes: readonly (string | undefined)[]): string | undefined {
  const parts = notes.filter((note): note is string => Boolean(note));
  return parts.length > 0 ? parts.join(' ') : undefined;
}
