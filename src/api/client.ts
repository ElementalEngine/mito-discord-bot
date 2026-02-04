import { config } from "../config.js";
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

export class ApiClient {
  private readonly base: string;
  private readonly fetcher: FetchLike;

  constructor(base = config.backend.url, fetcher: FetchLike = fetch) {
    this.base = base.replace(/\/+$/, "");
    this.fetcher = fetcher;
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

  private async fetchWithRetry(input: RequestInfo | URL, init?: RequestInit, attempts = 3): Promise<Response> {
    let lastErr: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30_000);
        const res = await this.fetcher(input, { ...init, signal: controller.signal });
        clearTimeout(timeout);
        if (!res.ok) {
          const body = await this.safeJson(res);
          throw new ApiError(`HTTP ${res.status}`, res.status, body);
        }
        return res;
      } catch (err) {
        lastErr = err;
        const status = err instanceof ApiError ? err.status : 0;
        const retriable = status === 0 || (status >= 500 && status <= 599);
        if (!retriable || i === attempts - 1) throw err;
        await new Promise(r => setTimeout(r, Math.min(2000, 200 * Math.pow(2, i))));
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