import type { EmbedBuilder } from 'discord.js';

import type { CivEdition } from '../config/types.js';
import type { Civ7StartingAge } from '../data/types.js';

export const DRAFT_GAME_TYPES = ['FFA', 'Teamer', 'Duel'] as const;
export type DraftGameType = (typeof DRAFT_GAME_TYPES)[number];

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
  leadersPerGroupMax?: number;
  civsPerGroup?: number;
  civsPerGroupMax?: number;
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
  startingAge: Civ7StartingAge;
  allocation: DraftAllocation;
  groups: readonly DraftGroup[];
}>;

export type DraftCommandRequest = Readonly<{
  edition: CivEdition;
  gameType: DraftGameType;
  startingAge?: Civ7StartingAge;
  numberPlayers?: number;
  numberTeams?: number;
  leaderBansRaw?: string;
  civBansRaw?: string;
}>;

export type DraftMessagePayload = Readonly<{
  content?: string;
  embeds?: readonly EmbedBuilder[];
  allowedMentions?: Readonly<{ parse: readonly [] }>;
}>;

export type DraftModeOutput = DraftMessagePayload &
  Readonly<{
    followUps?: readonly DraftMessagePayload[];
  }>;
