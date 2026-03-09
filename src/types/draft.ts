import type { Message, SendableChannels, User } from 'discord.js';

import type { CivEdition } from '../config/types.js';
import type { Civ7StartingAge } from '../data/types.js';

export type DraftGameType = 'FFA' | 'Teamer' | 'Duel';

export const DRAFT_MODES = ['standard', 'snake', 'random', 'cwc', 'blind'] as const;
export type DraftMode = (typeof DRAFT_MODES)[number];

export type Civ6DraftRequest = Readonly<{
  gameType: DraftGameType;
  numberPlayers?: number;
  numberTeams?: number;
  leaderBansRaw?: string;
}>;

export type Civ7DraftRequest = Readonly<{
  gameType: DraftGameType;
  startingAge: Civ7StartingAge;
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
  trimmedLeaders?: number;
  trimmedCivs?: number;
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
  startingAge: Civ7StartingAge;
  allocation: DraftAllocation;
  groups: readonly DraftGroup[];
}>;

export type DraftCommandRequest = Readonly<{
  source: 'command';
  edition: CivEdition;
  draftMode: 'standard';
  gameType: DraftGameType;
  startingAge?: Civ7StartingAge;
  numberPlayers?: number;
  numberTeams?: number;
  leaderBansRaw?: string;
  civBansRaw?: string;
}>;

export type VoteDraftRequest = Readonly<{
  source: 'vote';
  edition: CivEdition;
  draftMode: DraftMode;
  gameType: DraftGameType;
  startingAge?: Civ7StartingAge;
  numberPlayers?: number;
  numberTeams?: number;
  voterIds: readonly string[];
  commandChannel: SendableChannels;
  hostId: string;
  bannedLeaderKeys: readonly string[];
  bannedCivKeys: readonly string[];
  voterUsersById?: ReadonlyMap<string, User>;
  publicMessage?: Message<true>;
}>;

export type DraftRequest = DraftCommandRequest | VoteDraftRequest;
