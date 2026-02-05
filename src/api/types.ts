export type Edition = "CIV6" | "CIV7";

export type ParsedPlayer = {
  user_name?: string;
  steam_id?: string;
  discord_id?: string;
  player_alive: boolean;
  team: number;
  civ: string;
  leader?: string;
  placement: number;
  quit: boolean;
  delta?: number;
  season_delta?: number;
  combined_delta?: number;
  is_sub: boolean;
  subbed_out: boolean;
};

export type ParsedSave = {
  edition: Edition;
  leaders: string[];
  players: ParsedPlayer[];
};

export type UploadSaveResponse = {
  match_id: string;
  game: string;
  turn: number;
  age: string;
  map_type: string;
  game_mode: string;
  is_cloud: boolean;
  parser_version: string;
  discord_messages_id_list: string[];
  created_at: string;
  approved_at: string | null;
  approver_discord_id: string | null;
  flagged: boolean;
  flagged_by: string | null;
  players: ParsedPlayer[];
  repeated: boolean;
  reporter_discord_id: string;
};

export type GetMatchResponse = {
  match_id: string;
  game: string;
  turn: number;
  age: string;
  map_type: string;
  game_mode: string;
  is_cloud: boolean;
  parser_version: string;
  discord_messages_id_list: string[];
  created_at: string;
  approved_at: string | null;
  approver_discord_id: string | null;
  flagged: boolean;
  flagged_by: string | null;
  players: ParsedPlayer[];
  repeated: boolean;
  reporter_discord_id: string;
}

export type PlayerRanking = {
  discord_id: string;
  rating: number;
  games_played: number;
  wins: number;
  losses: number;
  first: string;
}

export type LeaderboardRanking = {
  player_rankings: PlayerRanking[];
  last_updated: number;
}

// ── Stats API (v1)

export type CivVersion = Lowercase<Edition>; 
export type StatsGameType = 'realtime' | 'cloud';

export type StatRow = {
  mu: number;
  sigma: number;
  games: number;
  wins: number;
  first: number;
  subbedIn: number;
  subbedOut: number;
  lastModified?: string | null;
};

export type StatSet = {
  ffa?: StatRow | null;
  teamer?: StatRow | null;
  duel?: StatRow | null;
};

export type UserStatsResponse = {
  discord_id: string;
  civ_version: CivVersion;
  game_type: StatsGameType;
  lifetime: StatSet;
  season: StatSet;
};

export type BatchStatsRequest = {
  civ_version: CivVersion;
  game_type: StatsGameType;
  discord_ids: string[];
};

export type BatchStatsResponse = {
  civ_version: CivVersion;
  game_type: StatsGameType;
  results: UserStatsResponse[];
};
