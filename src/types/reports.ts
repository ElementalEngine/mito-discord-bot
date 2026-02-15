import type { ParsedPlayer } from "../api/types.js";

export type GameMode = "realtime" | "cloud";

export type BaseReport = {
  match_id: string;
  repeated?: boolean;
  game: string;
  turn: number;
  map_type: string;
  game_mode: string;
  is_cloud: boolean;
  discord_messages_id_list: string[];
  players: ParsedPlayer[];
  reporter_discord_id: string;
  affected_players?: {
    discord_id: string;
    rating_mu: number;
  }[];
};

export type Civ6Player = ParsedPlayer & {
  civ: string; // key into CIV6_LEADERS
};

export type Civ7Player = ParsedPlayer & {
  civ: string;    // key into CIV7_CIVS
  leader: string; // key into CIV7_LEADERS
};

export type Civ6Report = BaseReport & {
};

export type Civ7Report = BaseReport & {
  age: string | number;
};