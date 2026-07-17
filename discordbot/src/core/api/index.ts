import type { TeamGenResponse } from "../../shared/teamgen.types.js";
import { HttpClient } from "./http.js";
import type { FetchLike } from "./http.js";
import { MatchesApi } from "./matches.api.js";
import { StatsApi } from "./stats.api.js";
import type {
  UploadSaveResponse,
  GetMatchResponse,
  LeaderboardRanking,
  UserStatsResponse,
  BatchStatsResponse,
  CivVersion,
  StatsGameType,
} from "./types.js";

export * from "./types.js";
export * from "./errors.js";
export { HttpClient } from "./http.js";
export { MatchesApi } from "./matches.api.js";
export { StatsApi } from "./stats.api.js";
export { UsersApi } from "./users.api.js";
export { SessionsApi } from "./sessions.api.js";
export type { DraftTelemetryRecord } from "./sessions.api.js";

/**
 * R1 FACADE — preserves the exact legacy ApiClient public surface so no legacy
 * call site changes. New (R3+) code imports the domain classes directly.
 * Delete at R9.1 together with the R1 shims.
 */
export class ApiClient {
  private readonly matches: MatchesApi;
  private readonly stats: StatsApi;

  // Optional passthrough — HttpClient owns the defaults (config URL/token, global fetch).
  constructor(base?: string, fetcher?: FetchLike, serviceToken?: string) {
    const http = new HttpClient(base, fetcher, serviceToken);
    this.matches = new MatchesApi(http);
    this.stats = new StatsApi(http);
  }

  uploadSave(fileBuf: Buffer, filename: string, reporterDiscordId: string, isCloud: boolean, discordMessageId: string): Promise<UploadSaveResponse> {
    return this.matches.uploadSave(fileBuf, filename, reporterDiscordId, isCloud, discordMessageId);
  }

  appendMessageIdList(matchId: string, messageIdList: string[]): Promise<UploadSaveResponse> {
    return this.matches.appendMessageIdList(matchId, messageIdList);
  }

  setPlayerOrder(matchId: string, playerOrder: string, discordMessageId: string): Promise<GetMatchResponse> {
    return this.matches.setPlayerOrder(matchId, playerOrder, discordMessageId);
  }

  changeOrder(matchId: string, newOrder: string, discordMessageId: string): Promise<GetMatchResponse> {
    return this.matches.changeOrder(matchId, newOrder, discordMessageId);
  }

  deletePendingMatch(matchId: string): Promise<GetMatchResponse> {
    return this.matches.deletePendingMatch(matchId);
  }

  getMatch(matchId: string): Promise<GetMatchResponse> {
    return this.matches.getMatch(matchId);
  }

  triggerQuit(matchId: string, quitterDiscordId: string, discordMessgeId: string): Promise<GetMatchResponse> {
    return this.matches.triggerQuit(matchId, quitterDiscordId, discordMessgeId);
  }

  assignDiscordId(matchId: string, playerId: string, playerDiscordId: string, discordMessageId: string): Promise<GetMatchResponse> {
    return this.matches.assignDiscordId(matchId, playerId, playerDiscordId, discordMessageId);
  }

  assignDiscordIdAll(matchId: string, discordIdList: string[], discordMessageId: string): Promise<GetMatchResponse> {
    return this.matches.assignDiscordIdAll(matchId, discordIdList, discordMessageId);
  }

  assignSub(matchId: string, subInId: string, subOutDiscordId: string, discordMessageId: string): Promise<GetMatchResponse> {
    return this.matches.assignSub(matchId, subInId, subOutDiscordId, discordMessageId);
  }

  removeSub(matchId: string, subOutId: string, discordMessageId: string): Promise<GetMatchResponse> {
    return this.matches.removeSub(matchId, subOutId, discordMessageId);
  }

  approveMatch(matchId: string, approverDiscordId: string): Promise<GetMatchResponse> {
    return this.matches.approveMatch(matchId, approverDiscordId);
  }

  getLeaderboardRanking(game: string, gameType:string, gameMode: string, isSeasonal: boolean, isCombined: boolean): Promise<LeaderboardRanking> {
    return this.stats.getLeaderboardRanking(game, gameType, gameMode, isSeasonal, isCombined);
  }

  contestReport(matchId: string, contestorDiscordId: string, reason: string, discordMessageId: string): Promise<GetMatchResponse> {
    return this.matches.contestReport(matchId, contestorDiscordId, reason, discordMessageId);
  }

  revertMatch(matchId: string): Promise<GetMatchResponse> {
    return this.matches.revertMatch(matchId);
  }

  getUserStats(civVersion: CivVersion, gameType: StatsGameType, discordId: string): Promise<UserStatsResponse> {
    return this.stats.getUserStats(civVersion, gameType, discordId);
  }

  getUsersStatsBatch(civVersion: CivVersion, gameType: StatsGameType, discordIds: string[]): Promise<BatchStatsResponse> {
    return this.stats.getUsersStatsBatch(civVersion, gameType, discordIds);
  }

  resetUserStats(civVersion: CivVersion, gameType: StatsGameType, discordId: string): Promise<UserStatsResponse> {
    return this.stats.resetUserStats(civVersion, gameType, discordId);
  }

  getTeamGen(civVersion: CivVersion, gameType: StatsGameType, discordIds: string[]): Promise<TeamGenResponse> {
    return this.stats.getTeamGen(civVersion, gameType, discordIds);
  }
}
