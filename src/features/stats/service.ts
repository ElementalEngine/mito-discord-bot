import { HttpClient } from '../../core/api/http.js';
import { StatsApi } from '../../core/api/stats.api.js';
import type {
  BatchStatsResponse,
  CivVersion,
  LeaderboardRanking,
  StatsGameType,
  UserStatsResponse,
} from '../../core/api/types.js';

export class StatsService {
  private readonly stats: StatsApi;

  constructor(stats: StatsApi = new StatsApi(new HttpClient())) {
    this.stats = stats;
  }

  getUserStats(
    opts: Readonly<{
      civVersion: CivVersion;
      gameType: StatsGameType;
      discordId: string;
    }>
  ): Promise<UserStatsResponse> {
    return this.stats.getUserStats(
      opts.civVersion,
      opts.gameType,
      opts.discordId
    );
  }

  getUsersStatsBatch(
    opts: Readonly<{
      civVersion: CivVersion;
      gameType: StatsGameType;
      discordIds: readonly string[];
    }>
  ): Promise<BatchStatsResponse> {
    return this.stats.getUsersStatsBatch(opts.civVersion, opts.gameType, [
      ...opts.discordIds,
    ]);
  }

  resetUserStats(
    opts: Readonly<{
      civVersion: CivVersion;
      gameType: StatsGameType;
      discordId: string;
    }>
  ): Promise<UserStatsResponse> {
    return this.stats.resetUserStats(
      opts.civVersion,
      opts.gameType,
      opts.discordId
    );
  }

  getLeaderboardRanking(
    opts: Readonly<{
      game: string;
      gameType: string;
      gameMode: string;
      isSeasonal: boolean;
      isCombined: boolean;
    }>
  ): Promise<LeaderboardRanking> {
    return this.stats.getLeaderboardRanking(
      opts.game,
      opts.gameType,
      opts.gameMode,
      opts.isSeasonal,
      opts.isCombined
    );
  }
}
