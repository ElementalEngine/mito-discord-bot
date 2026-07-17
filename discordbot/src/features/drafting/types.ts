import type { Civ7StartingAge } from '../../data/types.js';
import type { DraftGameType } from '../../shared/draft.types.js';

export type DraftCommandRequest =
  | Readonly<{
      edition: 'CIV6';
      gameType: DraftGameType;
      numberPlayers?: number;
      numberTeams?: number;
      leaderBansRaw?: string;
    }>
  | Readonly<{
      edition: 'CIV7';
      gameType: DraftGameType;
      startingAge: Civ7StartingAge;
      numberPlayers?: number;
      numberTeams?: number;
      leaderBansRaw?: string;
      civBansRaw?: string;
    }>;