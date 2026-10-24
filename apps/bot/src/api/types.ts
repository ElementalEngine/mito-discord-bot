import type { components } from '@cpl/contracts';
import type { CivEdition } from '../config/types.js';
export type GameMode = 'realtime' | 'cloud';
export type Edition = CivEdition;

export type PlayerLeaderboard = {
  discord_id: string;
  rating: number;
  games_played: number;
  wins: number;
  first: number;
}

export type LeaderboardRanking = {
  rankings: PlayerLeaderboard[];
  last_updated: number;
}

// ── Stats (C2, /api/v2/stats)

export type CivVersion = Lowercase<Edition>;
export type StatsGameType = GameMode;
export type StatRow = components['schemas']['StatRowV2'];
export type StatSet = components['schemas']['StatSetV2'];
export type UserStatsResponse = components['schemas']['UserStatsResponseV2'];
export type BatchStatsResponse = components['schemas']['BatchStatsResponseV2'];
export type TeamGenResponse = components['schemas']['TeamGenResponse'];
export type StatsSummary = components['schemas']['StatsSummary'];
export type HistoryPage = components['schemas']['HistoryPage'];
export type HistoryGame = components['schemas']['HistoryGame'];

// The fields Mite reads from a lobby document. The read route is untyped
// upstream, so this is the bot's own view of it, kept to what the embeds use.
export type LobbyDocument = {
  _id: string;
  phase: 'lobby' | 'settings' | 'bans' | 'draft' | 'complete' | 'cancelled';
  revision: number;
  guild_id: string;
  channel_id: string;
  voice_channel_id: string;
  host_discord_id: string;
  edition: 'civ6' | 'civ7';
  game_type: string;
  seat_count: number;
  min_seats: number;
  seats: { seat_index: number; discord_id: string; pick?: string | null; civ_pick?: string | null }[];
  // cwc only: captains pick for their teams; leaders[i] and civs[i] came together.
  teams?: { team_index: number; leaders: string[]; civs: string[] }[];
  host_rules?: string | null;
  settings?: Record<string, string>;
  bans?: { leader?: string[]; civ?: string[] };
  cancel_reason?: string | null;
  // Carried by the settings and complete phases, so a summary names each
  // setting the way the ballot did.
  questions?: { id: string; title: string; options: { id: string; label: string }[] }[];
};

// One edition's leaders and civs, as core-api serves them.
export type CivDataResponse = components['schemas']['CivDataResponse'];

// C1, the v2 match surface, as core-api declares it.
export type Match = components['schemas']['MatchResponse'];
export type MatchUpload = components['schemas']['UploadResponse'];
export type SeatEdit = components['schemas']['SeatPatchIn'];
export type SubQuota = components['schemas']['SubQuotaResponse'];

// Who is acting. Staff is the bot's assertion, sent only when true.
export type Actor = Readonly<{ id: string; isStaff?: boolean }>;
