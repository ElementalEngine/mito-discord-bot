import type { Leaderboard } from '../types/leaderboard.js';
import { config } from '../config.js';

const civ6_pbc_ffa_leaderboard = {
  name: 'Civ6_PBC_FFA',
  game: 'civ6',
  game_type: 'PBC',
  game_mode: 'ffa',
  is_seasonal: false,
  is_combined: false,
  thread_id: config.discord.channels.civ6PBCFFALeaderboard,
};
const civ6_pbc_teamer_leaderboard = {
  name: 'Civ6_PBC_Teamer',
  game: 'civ6',
  game_type: 'PBC',
  game_mode: 'teamer',
  is_seasonal: false,
  is_combined: false,
  thread_id: config.discord.channels.civ6PBCTeamerLeaderboard,
};
const civ6_pbc_duel_leaderboard = {
  name: 'Civ6_PBC_Duel',
  game: 'civ6',
  game_type: 'PBC',
  game_mode: 'duel',
  is_seasonal: false,
  is_combined: false,
  thread_id: config.discord.channels.civ6PBCDuelLeaderboard,
};
const civ6_pbc_combined_leaderboard = {
  name: 'Civ6_PBC_Combined',
  game: 'civ6',
  game_type: 'PBC',
  game_mode: 'combined',
  is_seasonal: false,
  is_combined: true,
  thread_id: config.discord.channels.civ6PBCCombinedLeaderboard,
};
const civ6_realtime_ffa_leaderboard = {
  name: 'Civ6_Realtime_FFA',
  game: 'civ6',
  game_type: 'realtime',
  game_mode: 'ffa',
  is_seasonal: false,
  is_combined: false,
  thread_id: config.discord.channels.civ6RealtimeFFALeaderboard,
};
const civ6_realtime_teamer_leaderboard = {
  name: 'Civ6_Realtime_Teamer',
  game: 'civ6',
  game_type: 'realtime',
  game_mode: 'teamer',
  is_seasonal: false,
  is_combined: false,
  thread_id: config.discord.channels.civ6RealtimeTeamerLeaderboard,
};
const civ6_realtime_duel_leaderboard = {
  name: 'Civ6_Realtime_Duel',
  game: 'civ6',
  game_type: 'realtime',
  game_mode: 'duel',
  is_seasonal: false,
  is_combined: false,
  thread_id: config.discord.channels.civ6RealtimeDuelLeaderboard,
};
const civ7_pbc_ffa_leaderboard = {
  name: 'Civ7_PBC_FFA',
  game: 'civ7',
  game_type: 'PBC',
  game_mode: 'ffa',
  is_seasonal: false,
  is_combined: false,
  thread_id: config.discord.channels.civ7PBCFFALeaderboard,
};
const civ7_pbc_teamer_leaderboard = {
  name: 'Civ7_PBC_Teamer',
  game: 'civ7',
  game_type: 'PBC',
  game_mode: 'teamer',
  is_seasonal: false,
  is_combined: false,
  thread_id: config.discord.channels.civ7PBCTeamerLeaderboard,
};
const civ7_pbc_duel_leaderboard = {
  name: 'Civ7_PBC_Duel',
  game: 'civ7',
  game_type: 'PBC',
  game_mode: 'duel',
  is_seasonal: false,
  is_combined: false,
  thread_id: config.discord.channels.civ7PBCDuelLeaderboard,
};
const civ7_pbc_combined_leaderboard = {
  name: 'Civ7_PBC_Combined',
  game: 'civ7',
  game_type: 'PBC',
  game_mode: 'combined',
  is_seasonal: false,
  is_combined: true,
  thread_id: config.discord.channels.civ7PBCCombinedLeaderboard,
};
const civ7_realtime_ffa_leaderboard = {
  name: 'Civ7_Realtime_FFA',
  game: 'civ7',
  game_type: 'realtime',
  game_mode: 'ffa',
  is_seasonal: false,
  is_combined: false,
  thread_id: config.discord.channels.civ7RealtimeFFALeaderboard,
};
const civ7_realtime_teamer_leaderboard = {
  name: 'Civ7_Realtime_Teamer',
  game: 'civ7',
  game_type: 'realtime',
  game_mode: 'teamer',
  is_seasonal: false,
  is_combined: false,
  thread_id: config.discord.channels.civ7RealtimeTeamerLeaderboard,
};
const civ7_realtime_duel_leaderboard = {
  name: 'Civ7_Realtime_Duel',
  game: 'civ7',
  game_type: 'realtime',
  game_mode: 'duel',
  is_seasonal: false,
  is_combined: false,
  thread_id: config.discord.channels.civ7RealtimeDuelLeaderboard,
};

const civ6_realtime_seasonal_ffa_leaderboard = {
  ...civ6_realtime_ffa_leaderboard,
  name: 'Civ6_Realtime_Seasonal_FFA',
  is_seasonal: true,
  is_combined: false,
  thread_id: config.discord.channels.civ6RealtimeSeasonalFFALeaderboard,
};
const civ6_realtime_seasonal_teamer_leaderboard = {
  ...civ6_realtime_teamer_leaderboard,
  name: 'Civ6_Realtime_Seasonal_Teamer',
  is_seasonal: true,
  is_combined: false,
  thread_id: config.discord.channels.civ6RealtimeSeasonalTeamerLeaderboard,
};
const civ6_realtime_seasonal_duel_leaderboard = {
  ...civ6_realtime_duel_leaderboard,
  name: 'Civ6_Realtime_Seasonal_Duel',
  is_seasonal: true,
  is_combined: false,
  thread_id: config.discord.channels.civ6RealtimeSeasonalDuelLeaderboard,
};
const civ7_realtime_seasonal_ffa_leaderboard = {
  ...civ7_realtime_ffa_leaderboard,
  name: 'Civ7_Realtime_Seasonal_FFA',
  is_seasonal: true,
  is_combined: false,
  thread_id: config.discord.channels.civ7RealtimeSeasonalFFALeaderboard,
};
const civ7_realtime_seasonal_teamer_leaderboard = {
  ...civ7_realtime_teamer_leaderboard,
  name: 'Civ7_Realtime_Seasonal_Teamer',
  is_seasonal: true,
  is_combined: false,
  thread_id: config.discord.channels.civ7RealtimeSeasonalTeamerLeaderboard,
};
const civ7_realtime_seasonal_duel_leaderboard = {
  ...civ7_realtime_duel_leaderboard,
  name: 'Civ7_Realtime_Seasonal_Duel',
  is_seasonal: true,
  is_combined: false,
  thread_id: config.discord.channels.civ7RealtimeSeasonalDuelLeaderboard,
};

export const leaderboardsList: Leaderboard[] = [
  civ6_realtime_seasonal_ffa_leaderboard,
  civ6_realtime_seasonal_teamer_leaderboard,
  civ6_realtime_seasonal_duel_leaderboard,
  civ7_realtime_seasonal_ffa_leaderboard,
  civ7_realtime_seasonal_teamer_leaderboard,
  civ7_realtime_seasonal_duel_leaderboard,
  civ6_realtime_ffa_leaderboard,
  civ6_realtime_teamer_leaderboard,
  civ6_realtime_duel_leaderboard,
  civ6_pbc_ffa_leaderboard,
  civ6_pbc_teamer_leaderboard,
  civ6_pbc_duel_leaderboard,
  civ6_pbc_combined_leaderboard,
  civ7_realtime_ffa_leaderboard,
  civ7_realtime_teamer_leaderboard,
  civ7_realtime_duel_leaderboard,
  civ7_pbc_ffa_leaderboard,
  civ7_pbc_teamer_leaderboard,
  civ7_pbc_duel_leaderboard,
  civ7_pbc_combined_leaderboard,
];
