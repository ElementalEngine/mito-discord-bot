import { ApiClient } from '../api/client.js';
import type {
  BatchStatsResponse,
  CivVersion,
  StatsGameType,
  UserStatsResponse,
} from '../api/types.js';

export class StatsService {
  constructor(private readonly api: ApiClient = new ApiClient()) {}

  getUserStats(opts: {
    civVersion: CivVersion;
    gameType: StatsGameType;
    discordId: string;
  }): Promise<UserStatsResponse> {
    return this.api.getUserStats(opts.civVersion, opts.gameType, opts.discordId);
  }

  getUsersStatsBatch(opts: {
    civVersion: CivVersion;
    gameType: StatsGameType;
    discordIds: string[];
  }): Promise<BatchStatsResponse> {
    return this.api.getUsersStatsBatch(opts.civVersion, opts.gameType, opts.discordIds);
  }
}
