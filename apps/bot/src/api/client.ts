import { config } from "../config.js";
import type { TeamGenResponse } from "../types/teamgen.types.js";
import { ApiError } from "./errors.js";
import type {
  UploadSaveResponse,
  GetMatchResponse,
  LeaderboardRanking,
  UserStatsResponse,
  BatchStatsResponse,
  CivVersion,
  StatsGameType,
} from "./types.js";

type FetchLike = typeof fetch;

// D93. The policy lives here and nowhere else: no call site chooses, and
// fetchWithRetry takes no attempts argument for one to pass.
const RETRY_ATTEMPTS = 2;
const RETRY_BASE_MS = 250;
const TIMEOUT_MS = 10_000;
// Multipart carries a save file. Everything else is a form post or a query.
const UPLOAD_TIMEOUT_MS = 30_000;

export class ApiClient {
  private readonly base: string;
  private readonly fetcher: FetchLike;
  private readonly serviceToken: string;

  constructor(base = config.backend.url, fetcher: FetchLike = fetch, serviceToken = config.backend.serviceToken) {
    this.base = base.replace(/\/+$/, "");
    this.fetcher = fetcher;
    this.serviceToken = serviceToken;
  }

  async uploadSave(fileBuf: Buffer, filename: string, reporterDiscordId: string, isCloud: boolean, discordMessageId: string): Promise<UploadSaveResponse> {
    const form = new FormData();
    // TS typing-safe for Node: wrap Buffer in Uint8Array for File/Blob
    form.append("file", new File([new Uint8Array(fileBuf)], filename));
    form.append("reporter_discord_id", reporterDiscordId);
    form.append("is_cloud", isCloud ? "1" : "0");
    form.append("discord_message_id", discordMessageId);

    const res = await this.fetchWithRetry(`${this.base}/api/v1/upload-game-report/`, {
      method: "POST",
      body: form,
    });

    return (await this.parseJson(res)) as UploadSaveResponse;
  }

  async appendMessageIdList(matchId: string, messageIdList: string[]): Promise<UploadSaveResponse> {
    const form = new FormData();
    form.append("match_id", matchId);
    for (const msgId of messageIdList) {
      form.append("discord_message_id", msgId);
    }
    const res = await this.fetchWithRetry(`${this.base}/api/v1/append-message-id-list/`, {
      method: "PUT",
      body: form,
    });
    return (await this.parseJson(res)) as UploadSaveResponse;
  }

  async setPlayerOrder(matchId: string, playerOrder: string, discordMessageId: string): Promise<GetMatchResponse> {
    const form = new FormData();
    form.append("match_id", matchId);
    form.append("player_order", playerOrder);
    form.append("discord_message_id", discordMessageId);

    const res = await this.fetchWithRetry(`${this.base}/api/v1/set-player-order/`, {
      method: "PUT",
      body: form,
    });

    return (await this.parseJson(res)) as GetMatchResponse;
  }

  async changeOrder(matchId: string, newOrder: string, discordMessageId: string): Promise<GetMatchResponse> {
    const form = new FormData();
    form.append("match_id", matchId);
    form.append("new_order", newOrder);
    form.append("discord_message_id", discordMessageId);

    const res = await this.fetchWithRetry(`${this.base}/api/v1/change-order/`, {
      method: "PUT",
      body: form,
    });

    return (await this.parseJson(res)) as GetMatchResponse;
  }

  async deletePendingMatch(matchId: string): Promise<GetMatchResponse> {
    const form = new FormData();
    form.append("match_id", matchId);

    const res = await this.fetchWithRetry(`${this.base}/api/v1/delete-pending-match/`, {
      method: "PUT",
      body: form
    });

    return (await this.parseJson(res)) as GetMatchResponse;
  }

  async getMatch(matchId: string): Promise<GetMatchResponse> {
    const form = new FormData();
    form.append("match_id", matchId);

    const res = await this.fetchWithRetry(`${this.base}/api/v1/get-match/`, {
      method: "PUT",
      body: form
    });

    return (await this.parseJson(res)) as GetMatchResponse;
  }

  async triggerQuit(matchId: string, quitterDiscordId: string, discordMessgeId: string): Promise<GetMatchResponse> {
    const form = new FormData();
    form.append("match_id", matchId);
    form.append("quitter_discord_id", quitterDiscordId);
    form.append("discord_message_id", discordMessgeId);

    const res = await this.fetchWithRetry(`${this.base}/api/v1/trigger-quit/`, {
      method: "PUT",
      body: form,
    });

    return (await this.parseJson(res)) as GetMatchResponse;
  }

  async assignDiscordId(matchId: string, playerId: string, playerDiscordId: string, discordMessageId: string): Promise<GetMatchResponse> {
    const form = new FormData();
    form.append("match_id", matchId);
    form.append("player_id", playerId);
    form.append("player_discord_id", playerDiscordId);
    form.append("discord_message_id", discordMessageId);

    const res = await this.fetchWithRetry(`${this.base}/api/v1/assign-discord-id/`, {
      method: "PUT",
      body: form,
    });

    return (await this.parseJson(res)) as GetMatchResponse;
  }

  async assignDiscordIdAll(matchId: string, discordIdList: string[], discordMessageId: string): Promise<GetMatchResponse> {
    const form = new FormData();
    form.append("match_id", matchId);
    for (const discordId of discordIdList) {
      form.append("discord_id_list", discordId);
    }
    form.append("discord_message_id", discordMessageId);

    const res = await this.fetchWithRetry(`${this.base}/api/v1/assign-discord-id-all/`, {
      method: "PUT",
      body: form,
    });

    return (await this.parseJson(res)) as GetMatchResponse;
  }

  async assignSub(matchId: string, subInId: string, subOutDiscordId: string, discordMessageId: string): Promise<GetMatchResponse> {
    const form = new FormData();
    form.append("match_id", matchId);
    form.append("sub_in_id", subInId);
    form.append("sub_out_discord_id", subOutDiscordId);
    form.append("discord_message_id", discordMessageId);

    const res = await this.fetchWithRetry(`${this.base}/api/v1/assign-sub/`, {
      method: "PUT",
      body: form,
    });

    return (await this.parseJson(res)) as GetMatchResponse;
  }

  async removeSub(matchId: string, subOutId: string, discordMessageId: string): Promise<GetMatchResponse> {
    const form = new FormData();
    form.append("match_id", matchId);
    form.append("sub_out_id", subOutId);
    form.append("discord_message_id", discordMessageId);

    const res = await this.fetchWithRetry(`${this.base}/api/v1/remove-sub/`, {
      method: "PUT",
      body: form,
    });

    return (await this.parseJson(res)) as GetMatchResponse;
  }

  async approveMatch(matchId: string, approverDiscordId: string): Promise<GetMatchResponse> {
    const form = new FormData();
    form.append("match_id", matchId);
    form.append("approver_discord_id", approverDiscordId);

    const res = await this.fetchWithRetry(`${this.base}/api/v1/approve-match/`, {
      method: "PUT",
      body: form,
    });

    return (await this.parseJson(res)) as GetMatchResponse;
  }

  async getLeaderboardRanking(game: string, gameType:string, gameMode: string, isSeasonal: boolean, isCombined: boolean): Promise<LeaderboardRanking> {
    const form = new FormData();
    form.append("game", game);
    form.append("game_type", gameType)
    form.append("game_mode", gameMode);
    form.append("is_seasonal", isSeasonal ? "1" : "0");
    form.append("is_combined", isCombined ? "1" : "0");

    const res = await this.fetchWithRetry(`${this.base}/api/v1/get-leaderboard-ranking/`, {
      method: "PUT",
      body: form,
    });

    return (await this.parseJson(res)) as LeaderboardRanking;
  }

  async contestReport(matchId: string, contestorDiscordId: string, reason: string, discordMessageId: string): Promise<GetMatchResponse> {
    const form = new FormData();
    form.append("match_id", matchId);
    form.append("contestor_discord_id", contestorDiscordId);
    form.append("reason", reason);
    form.append("discord_message_id", discordMessageId);

    const res = await this.fetchWithRetry(`${this.base}/api/v1/contest-report/`, {
      method: "PUT",
      body: form,
    });

    return (await this.parseJson(res)) as GetMatchResponse;
  }

  async revertMatch(matchId: string): Promise<GetMatchResponse> {
    const form = new FormData();
    form.append("match_id", matchId);

    const res = await this.fetchWithRetry(`${this.base}/api/v1/revert-match/`, {
      method: "PUT",
      body: form,
    });

    return (await this.parseJson(res)) as GetMatchResponse;
  }

  async getUserStats(civVersion: CivVersion, gameType: StatsGameType, discordId: string): Promise<UserStatsResponse> {
    const params = new URLSearchParams({
      civ_version: civVersion,
      game_type: gameType,
      discord_id: discordId,
    });

    const res = await this.fetchWithRetry(`${this.base}/api/v1/stats/user?${params.toString()}`, {
      method: "GET",
    });

    return (await this.parseJson(res)) as UserStatsResponse;
  }

  async getUsersStatsBatch(
    civVersion: CivVersion,
    gameType: StatsGameType,
    discordIds: string[]
  ): Promise<BatchStatsResponse> {
    const res = await this.fetchWithRetry(`${this.base}/api/v1/stats/batch`, {
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

    return (await this.parseJson(res)) as BatchStatsResponse;
  }

  async resetUserStats(civVersion: CivVersion, gameType: StatsGameType, discordId: string): Promise<UserStatsResponse> {
    const params = new URLSearchParams({
      civ_version: civVersion,
      game_type: gameType,
      discord_id: discordId,
    });

    const res = await this.fetchWithRetry(`${this.base}/api/v1/stats/reset/user?${params.toString()}`, {
      method: "PUT",
    });

    return (await this.parseJson(res)) as UserStatsResponse;
  }

  async getTeamGen(
    civVersion: CivVersion,
    gameType: StatsGameType,
    discordIds: string[]
  ): Promise<TeamGenResponse> {
    const res = await this.fetchWithRetry(`${this.base}/api/v1/stats/team-gen`, {
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

    return (await this.parseJson(res)) as TeamGenResponse;
  }

  /**
   * D93. Two attempts, and whether the second happens is decided here.
   *
   * An enveloped error means core-api answered and chose not to act, so
   * its retryable flag can be trusted on any method. A transport failure
   * -- timeout, reset, a proxy 502 -- means we never learned whether the
   * write landed, so only a read may be repeated. Fifteen of this client's
   * nineteen calls are PUTs that approve, revert or mutate a match.
   */
  private shouldRetry(err: unknown, method: string): boolean {
    if (err instanceof ApiError && typeof err.retryable === "boolean") {
      return err.retryable;
    }
    if (err instanceof ApiError && err.status > 0 && err.status < 500) {
      return false;
    }
    return method === "GET";
  }

  private async fetchWithRetry(input: string | URL, init?: RequestInit): Promise<Response> {
    const method = (init?.method ?? "GET").toUpperCase();
    const timeoutMs = init?.body instanceof FormData ? UPLOAD_TIMEOUT_MS : TIMEOUT_MS;

    let lastErr: unknown;
    for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const headers = new Headers(init?.headers);
          if (this.serviceToken) headers.set("authorization", `Bearer ${this.serviceToken}`);
          const res = await this.fetcher(input, { ...init, headers, signal: controller.signal });
          if (!res.ok) {
            const body = await this.safeJson(res);
            throw new ApiError(`HTTP ${res.status}`, res.status, body);
          }
          return res;
        } finally {
          clearTimeout(timeout);
        }
      } catch (err) {
        lastErr = err;
        if (attempt === RETRY_ATTEMPTS || !this.shouldRetry(err, method)) throw err;
        // Jittered, so a backend blip does not bring every shard back at once.
        await new Promise(r => setTimeout(r, RETRY_BASE_MS * (1 + Math.random())));
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error("Unknown API error");
  }

  private async parseJson(res: Response): Promise<unknown> {
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new ApiError("Invalid JSON from backend", res.status, text);
    }
  }

  private async safeJson(res: Response): Promise<unknown | string> {
    const text = await res.text().catch(() => "");
    try {
      return text ? JSON.parse(text) : "";
    } catch {
      return text;
    }
  }
}