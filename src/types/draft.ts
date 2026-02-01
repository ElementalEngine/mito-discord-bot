import type { AgePool } from '../data/index.js';

export type DraftGameType = 'FFA' | 'Teamer' | 'Duel';

export type Civ6DraftRequest = Readonly<{
  gameType: DraftGameType;
  numberPlayers?: number;
  numberTeams?: number;
  leaderBansRaw?: string;
}>;

export type Civ7DraftRequest = Readonly<{
  gameType: DraftGameType;
  startingAge: AgePool;
  numberPlayers?: number;
  numberTeams?: number;
  leaderBansRaw?: string;
  civBansRaw?: string;
}>;

export type DraftGroupKind = 'Player' | 'Team';

export type DraftAllocation = Readonly<{
  groupKind: DraftGroupKind;
  groupCount: number;
  leadersPerGroup: number;
  civsPerGroup?: number;
  note?: string;
  bannedLeaders?: readonly string[];
  ignoredLeaderBans?: readonly string[];
  bannedCivs?: readonly string[];
  ignoredCivBans?: readonly string[];
}>;

export type DraftGroup = Readonly<{
  leaders: readonly string[];
  civs?: readonly string[];
}>;

export type Civ6DraftResult = Readonly<{
  gameVersion: 'civ6';
  gameType: DraftGameType;
  allocation: DraftAllocation;
  groups: readonly DraftGroup[];
}>;

export type Civ7DraftResult = Readonly<{
  gameVersion: 'civ7';
  gameType: DraftGameType;
  startingAge: AgePool;
  allocation: DraftAllocation;
  groups: readonly DraftGroup[];
}>;
