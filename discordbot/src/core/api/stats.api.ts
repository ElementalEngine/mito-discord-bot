import type { TeamGenResponse } from "../../shared/teamgen.types.js";
import type { HttpClient } from "./http.js";
import type {
  LeaderboardRanking,
  UserStatsResponse,
  BatchStatsResponse,
  CivVersion,
  StatsGameType,
} from "./types.js";

/** Stats/leaderboard/team-gen reads. Method bodies verbatim from the legacy ApiClient (wire contract frozen). */
export class StatsApi {
  readonly http: HttpClient;

  constructor(http: HttpClient) {
    this.http = http;
  }

  async getLeaderboardRanking(game: string, gameType:string, gameMode: string, isSeasonal: boolean, isCombined: boolean): Promise<LeaderboardRanking> {
    const form = new FormData();
    form.append("game", game);
    form.append("game_type", gameType)
    form.append("game_mode", gameMode);
    form.append("is_seasonal", isSeasonal ? "1" : "0");
    form.append("is_combined", isCombined ? "1" : "0");

    const res = await this.http.fetchWithRetry(`${this.http.base}/api/v1/get-leaderboard-ranking/`, {
      method: "PUT",
      body: form,
    });

    return (await this.http.parseJson(res)) as LeaderboardRanking;
  }

  async getUserStats(civVersion: CivVersion, gameType: StatsGameType, discordId: string): Promise<UserStatsResponse> {
    const params = new URLSearchParams({
      civ_version: civVersion,
      game_type: gameType,
      discord_id: discordId,
    });

    const res = await this.http.fetchWithRetry(`${this.http.base}/api/v1/stats/user?${params.toString()}`, {
      method: "GET",
    });

    return (await this.http.parseJson(res)) as UserStatsResponse;
  }

  async getUsersStatsBatch(
    civVersion: CivVersion,
    gameType: StatsGameType,
    discordIds: string[]
  ): Promise<BatchStatsResponse> {
    const res = await this.http.fetchWithRetry(`${this.http.base}/api/v1/stats/batch`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        civ_version: civVersion,
        game_type: gameType,
        discord_ids: discordIds,
      }),
    });

    return (await this.http.parseJson(res)) as BatchStatsResponse;
  }

  async resetUserStats(civVersion: CivVersion, gameType: StatsGameType, discordId: string): Promise<UserStatsResponse> {
    const params = new URLSearchParams({
      civ_version: civVersion,
      game_type: gameType,
      discord_id: discordId,
    });

    const res = await this.http.fetchWithRetry(`${this.http.base}/api/v1/stats/reset/user?${params.toString()}`, {
      method: "PUT",
    });

    return (await this.http.parseJson(res)) as UserStatsResponse;
  }

  async getTeamGen(
    civVersion: CivVersion,
    gameType: StatsGameType,
    discordIds: string[]
  ): Promise<TeamGenResponse> {
    const res = await this.http.fetchWithRetry(`${this.http.base}/api/v1/stats/team-gen`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        civ_version: civVersion,
        game_type: gameType,
        discord_ids: discordIds,
      }),
    });

    return (await this.http.parseJson(res)) as TeamGenResponse;
  }
}
