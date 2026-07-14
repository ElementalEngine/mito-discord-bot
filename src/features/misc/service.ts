import { HttpClient } from '../../core/api/http.js';
import { StatsApi } from '../../core/api/stats.api.js';
import type { CivVersion, StatsGameType } from '../../core/api/types.js';
import type { TeamGenResponse } from '../../shared/teamgen.types.js';

export class TeamGenService {
  private readonly stats: StatsApi;

  constructor(stats: StatsApi = new StatsApi(new HttpClient())) {
    this.stats = stats;
  }

  getTeamGen(
    opts: Readonly<{
      civVersion: CivVersion;
      gameType: StatsGameType;
      discordIds: readonly string[];
    }>
  ): Promise<TeamGenResponse> {
    return this.stats.getTeamGen(opts.civVersion, opts.gameType, [
      ...opts.discordIds,
    ]);
  }
}