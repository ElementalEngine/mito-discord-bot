import type { components } from '@cpl/contracts';
import { config } from "../config.js";
import type { TeamGenResponse } from "../types/teamgen.types.js";
import { ApiError } from "./errors.js";
import type {
  LeaderboardRanking,
  UserStatsResponse,
  BatchStatsResponse,
  CivVersion,
  StatsGameType,
  LobbyDocument,
  CivDataResponse,
  Actor,
  Match,
  MatchUpload,
  SeatEdit,
  SubQuota,
} from './types.js';

type FetchLike = typeof fetch;

// D93. The policy lives here and nowhere else: no call site chooses, and
// fetchWithRetry takes no attempts argument for one to pass.
const RETRY_ATTEMPTS = 2;
const RETRY_BASE_MS = 250;
const TIMEOUT_MS = 10_000;
// Multipart carries a save file. Everything else is a form post or a query.
const UPLOAD_TIMEOUT_MS = 30_000;

const actorHeaders = (actor: Actor): Record<string, string> => ({
  "x-actor-discord-id": actor.id,
  ...(actor.isStaff ? { "x-actor-is-staff": "true" } : {}),
});

const json = { "content-type": "application/json" };

export class ApiClient {
  private readonly base: string;
  private readonly fetcher: FetchLike;
  private readonly serviceToken: string;

  constructor(base = config.backend.url, fetcher: FetchLike = fetch, serviceToken = config.backend.serviceToken) {
    this.base = base.replace(/\/+$/, "");
    this.fetcher = fetcher;
    this.serviceToken = serviceToken;
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
  async createLobby(body: components['schemas']['CreateLobbyRequest'], hostName?: string): Promise<LobbyDocument> {
    const res = await this.fetchWithRetry(`${this.base}/api/v2/lobbies/mite`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(hostName ? { "x-actor-name": encodeURIComponent(hostName) } : {}) },
      body: JSON.stringify(body)
    });

    return (await this.parseJson(res)) as LobbyDocument;
  }

  // The oldest finished lobby nobody has posted yet, or null when there is none.
  async claimLobbyPost(guildId: string): Promise<LobbyDocument | null> {
    const res = await this.fetchWithRetry(
      `${this.base}/api/v2/lobbies/mite/claim-post?guild_id=${encodeURIComponent(guildId)}`,
      { method: "POST" }
    );
    if (res.status === 204) return null;

    return (await this.parseJson(res)) as LobbyDocument;
  }

  // Display names and portraits for one edition. A read, so a transport
  // failure is retried like any other.
  async getCivData(edition: LobbyDocument['edition']): Promise<CivDataResponse> {
    const res = await this.fetchWithRetry(`${this.base}/api/v2/civ-data/${edition}`, { method: "GET" });

    return (await this.parseJson(res)) as CivDataResponse;
  }

  // Closes every lobby untouched past the stale cutoff. Returns how many.
  async sweepStaleLobbies(): Promise<number> {
    const res = await this.fetchWithRetry(`${this.base}/api/v2/lobbies/mite/sweep`, { method: "POST" });
    const body = (await this.parseJson(res)) as { closed?: number };

    return body.closed ?? 0;
  }

  // The viewer decides the censoring, so browse carries an actor like the rest.
  async browseLobbies(guildId: string, actor: string, channelId?: string): Promise<LobbyDocument[]> {
    const query = new URLSearchParams({ guild_id: guildId });
    if (channelId) query.set("channel_id", channelId);
    const res = await this.fetchWithRetry(`${this.base}/api/v2/lobbies/mite?${query}`, {
      method: "GET",
      headers: { "x-actor-discord-id": actor }
    });

    return (await this.parseJson(res)) as LobbyDocument[];
  }

  // Staff cancel on the host's behalf; the header decides, not the caller.
  async cancelLobby(lobbyId: string, actor: string, expectedRevision: number, isStaff = false): Promise<LobbyDocument> {
    const res = await this.fetchWithRetry(`${this.base}/api/v2/lobbies/mite/${lobbyId}/cancel`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-actor-discord-id": actor,
        ...(isStaff ? { "x-actor-is-staff": "true" } : {})
      },
      body: JSON.stringify({ expected_revision: expectedRevision })
    });

    return (await this.parseJson(res)) as LobbyDocument;
  }

  async leaveLobby(lobbyId: string, actor: string, expectedRevision: number): Promise<LobbyDocument> {
    const res = await this.fetchWithRetry(`${this.base}/api/v2/lobbies/mite/${lobbyId}/leave`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-actor-discord-id": actor },
      body: JSON.stringify({ expected_revision: expectedRevision, action: "leave" })
    });

    return (await this.parseJson(res)) as LobbyDocument;
  }

  // C1. The reporter rules live in core-api; staff is asserted from here.
  async uploadMatch(file: Buffer, filename: string, actorId: string, isCloud: boolean, messageId: string): Promise<MatchUpload> {
    const form = new FormData();
    form.append("file", new File([new Uint8Array(file)], filename));
    form.append("is_cloud", isCloud ? "1" : "0");
    form.append("discord_message_id", messageId);
    const res = await this.fetchWithRetry(`${this.base}/api/v2/matches`, {
      method: "POST",
      headers: { "x-actor-discord-id": actorId },
      body: form,
    });
    return (await this.parseJson(res)) as MatchUpload;
  }

  async match(matchId: string): Promise<Match> {
    const res = await this.fetchWithRetry(`${this.base}/api/v2/matches/${encodeURIComponent(matchId)}`, { method: "GET" });
    return (await this.parseJson(res)) as Match;
  }

  async editSeats(matchId: string, seats: readonly SeatEdit[], actor: Actor): Promise<Match> {
    const res = await this.fetchWithRetry(`${this.base}/api/v2/matches/${encodeURIComponent(matchId)}/players`, {
      method: "PATCH",
      headers: { ...json, ...actorHeaders(actor) },
      body: JSON.stringify({ players: seats }),
    });
    return (await this.parseJson(res)) as Match;
  }

  async approve(matchId: string, actor: Actor): Promise<Match> {
    const res = await this.fetchWithRetry(`${this.base}/api/v2/matches/${encodeURIComponent(matchId)}/approve`, {
      method: "POST",
      headers: actorHeaders(actor),
    });
    return (await this.parseJson(res)) as Match;
  }

  async contest(matchId: string, reason: string, actor: Actor): Promise<Match> {
    const res = await this.fetchWithRetry(`${this.base}/api/v2/matches/${encodeURIComponent(matchId)}/contest`, {
      method: "POST",
      headers: { ...json, ...actorHeaders(actor) },
      body: JSON.stringify({ reason }),
    });
    return (await this.parseJson(res)) as Match;
  }

  async revert(matchId: string): Promise<Match> {
    const res = await this.fetchWithRetry(`${this.base}/api/v2/matches/${encodeURIComponent(matchId)}/revert`, { method: "POST" });
    return (await this.parseJson(res)) as Match;
  }

  async removeMatch(matchId: string, actor: Actor): Promise<Match> {
    const res = await this.fetchWithRetry(`${this.base}/api/v2/matches/${encodeURIComponent(matchId)}`, {
      method: "DELETE",
      headers: actorHeaders(actor),
    });
    return (await this.parseJson(res)) as Match;
  }

  async subQuota(discordId: string): Promise<SubQuota> {
    const query = new URLSearchParams({ discord_id: discordId });
    const res = await this.fetchWithRetry(`${this.base}/api/v2/matches/sub-quota?${query}`, { method: "GET" });
    return (await this.parseJson(res)) as SubQuota;
  }

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
        const headers = new Headers(init?.headers);
        if (this.serviceToken) headers.set("authorization", `Bearer ${this.serviceToken}`);
        // The signal outlives this call, so reading the body is timed too.
        const res = await this.fetcher(input, { ...init, headers, signal: AbortSignal.timeout(timeoutMs) });
        if (!res.ok) {
          const body = await this.safeJson(res);
          throw new ApiError(`HTTP ${res.status}`, res.status, body);
        }
        return res;
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