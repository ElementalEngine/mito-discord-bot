import { ApiClient } from '../api/client.js';
import type {
  CivVersion,
  StatsGameType,
} from '../api/types.js';
import type { TeamGenResponse } from '../types/teamgen.types.js';

export class TeamGenService {
  constructor(private readonly api: ApiClient = new ApiClient()) {}

  getTeamGen(opts: {
    civVersion: CivVersion;
    gameType: StatsGameType;
    discordIds: string[];
  }): Promise<TeamGenResponse> {
    return this.api.getTeamGen(opts.civVersion, opts.gameType, opts.discordIds);
  }
}
