import { config } from "../config.js";
import { ApiError } from "./errors.js";
import type {
  LeaderboardRanking,
  UserStatsResponse,
  BatchStatsResponse,
  CivVersion,
  StatsGameType,
  CivDataResponse,
  DraftDeal,
  DraftRequest,
  Lobby,
  LobbyBallot,
  LobbyEdit,
  LobbyRequest,
  SettingQuestion,
  VotePlace,
  Vote,
  VoteBallot,
  VoteMessages,
  VoteRequest,
  Actor,
  Match,
  MatchUpload,
  SeatEdit,
  SubQuota,
  TeamGenResponse,
  StatsSummary,
  HistoryPage,
  ResetStatsResponse,
  SeasonPreview,
  SeasonRolled,
} from './types.js';

type FetchLike = typeof fetch;

// The retry policy lives here and nowhere else: no call site chooses, and
// fetchWithRetry takes no attempts argument for one to pass.
const RETRY_ATTEMPTS = 2;
const RETRY_BASE_MS = 250;
const TIMEOUT_MS = 10_000;
// Multipart carries a save file. Everything else is JSON or a query.
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

  // One leaderboard's rankings; a read, so a dropped answer is asked again.
  async getLeaderboardRanking(game: string, gameType: string, gameMode: string, isSeasonal: boolean, isCombined: boolean): Promise<LeaderboardRanking> {
    const query = new URLSearchParams({
      game,
      game_type: gameType,
      game_mode: gameMode,
      is_seasonal: String(isSeasonal),
      is_combined: String(isCombined),
    });
    const res = await this.fetchWithRetry(`${this.base}/api/v2/matches/leaderboard?${query}`, { method: "GET" });
    return (await this.parseJson(res)) as LeaderboardRanking;
  }

  async getUserStats(civVersion: CivVersion, gameType: StatsGameType, discordId: string): Promise<UserStatsResponse> {
    const params = new URLSearchParams({
      civ_version: civVersion,
      game_type: gameType,
      discord_id: discordId,
    });

    const res = await this.fetchWithRetry(`${this.base}/api/v2/stats/user?${params.toString()}`, {
      method: "GET",
    });

    return (await this.parseJson(res)) as UserStatsResponse;
  }

  async getUsersStatsBatch(
    civVersion: CivVersion,
    gameType: StatsGameType,
    discordIds: string[]
  ): Promise<BatchStatsResponse> {
    const res = await this.fetchWithRetry(`${this.base}/api/v2/stats/batch`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({
        civ_version: civVersion,
        game_type: gameType,
        discord_ids: discordIds,
      }),
    });

    return (await this.parseJson(res)) as BatchStatsResponse;
  }

  async resetUserStats(civVersion: CivVersion, gameType: StatsGameType, discordId: string): Promise<ResetStatsResponse> {
    const params = new URLSearchParams({
      civ_version: civVersion,
      game_type: gameType,
      discord_id: discordId,
    });

    const res = await this.fetchWithRetry(`${this.base}/api/v2/stats/reset/user?${params.toString()}`, {
      method: "PUT",
    });

    return (await this.parseJson(res)) as ResetStatsResponse;
  }

  // The edition's open season, and the season records starting the next would clear.
  async getSeason(edition: CivVersion): Promise<SeasonPreview> {
    const res = await this.fetchWithRetry(`${this.base}/api/v2/seasons/${edition}`, { method: "GET" });
    return (await this.parseJson(res)) as SeasonPreview;
  }

  // Ends `expected` and starts the next season; refused once it is no longer open.
  async startNextSeason(edition: CivVersion, expected: string, actorId: string): Promise<SeasonRolled> {
    const res = await this.fetchWithRetry(`${this.base}/api/v2/seasons/${edition}/next`, {
      method: "POST",
      headers: { ...json, "x-actor-discord-id": actorId },
      body: JSON.stringify({ expected }),
    });
    return (await this.parseJson(res)) as SeasonRolled;
  }

  // Games by map and the most played civs, since the player's last reset.
  async getStatsSummary(civVersion: CivVersion, gameType: StatsGameType, discordId: string): Promise<StatsSummary> {
    const query = new URLSearchParams({ civ_version: civVersion, game_type: gameType, discord_id: discordId });
    const res = await this.fetchWithRetry(`${this.base}/api/v2/stats/summary?${query}`, { method: "GET" });
    return (await this.parseJson(res)) as StatsSummary;
  }

  // One page of a player's approved games, newest first; page 0 is the latest.
  async getStatsHistory(civVersion: CivVersion, gameType: StatsGameType, discordId: string, page: number): Promise<HistoryPage> {
    const query = new URLSearchParams({ civ_version: civVersion, game_type: gameType, discord_id: discordId, page: String(page) });
    const res = await this.fetchWithRetry(`${this.base}/api/v2/stats/history?${query}`, { method: "GET" });
    return (await this.parseJson(res)) as HistoryPage;
  }

  async getTeamGen(
    civVersion: CivVersion,
    gameType: StatsGameType,
    discordIds: string[]
  ): Promise<TeamGenResponse> {
    const res = await this.fetchWithRetry(`${this.base}/api/v2/stats/team-gen`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({
        civ_version: civVersion,
        game_type: gameType,
        discord_ids: discordIds,
      }),
    });

    return (await this.parseJson(res)) as TeamGenResponse;
  }

  // Display names and portraits for one edition. A read, so a transport
  // failure is retried like any other.
  async getCivData(edition: CivVersion): Promise<CivDataResponse> {
    const res = await this.fetchWithRetry(`${this.base}/api/v2/civ-data/${edition}`, { method: "GET" });

    return (await this.parseJson(res)) as CivDataResponse;
  }

  // core-api's readiness and its database's ping time. Throws when it is not ready.
  async ping(): Promise<{ dbMs: number | null }> {
    const res = await this.fetchWithRetry(`${this.base}/readyz`, { method: "GET" });
    const body = (await this.parseJson(res)) as { db_ms?: unknown };
    return { dbMs: typeof body.db_ms === "number" ? body.db_ms : null };
  }

  // One /draft deal, which core-api also records.
  async dealDraft(body: DraftRequest): Promise<DraftDeal> {
    const res = await this.fetchWithRetry(`${this.base}/api/v2/match-setups/draft`, {
      method: "POST",
      headers: json,
      body: JSON.stringify(body)
    });

    return (await this.parseJson(res)) as DraftDeal;
  }

  // The settings a lobby's host may fix for its game type.
  async lobbySettings(edition: CivVersion, gameType: string): Promise<SettingQuestion[]> {
    const res = await this.fetchWithRetry(`${this.base}/api/v2/match-setups/settings/${edition}/${encodeURIComponent(gameType)}`, { method: "GET" });
    return (await this.parseJson(res)) as SettingQuestion[];
  }

  async hostLobby(body: LobbyRequest, host: Actor): Promise<Lobby> {
    return this.lobbyCall("", "POST", host, body);
  }

  async lobby(lobbyId: string): Promise<Lobby> {
    const res = await this.fetchWithRetry(this.lobbyUrl(lobbyId), { method: "GET" });
    return (await this.parseJson(res)) as Lobby;
  }

  // The live lobbies players can join; with a host, that host's own, live or in setup.
  async openLobbies(guildId: string, hostId?: string): Promise<Lobby[]> {
    const query = new URLSearchParams({ guild_id: guildId, ...(hostId ? { host_id: hostId } : {}) });
    const res = await this.fetchWithRetry(`${this.lobbyUrl("")}?${query}`, { method: "GET" });
    return (await this.parseJson(res)) as Lobby[];
  }

  // Every lobby idle past its limit, closed so its post can say so.
  async closeIdleLobbies(): Promise<Lobby[]> {
    const res = await this.fetchWithRetry(this.lobbyUrl("close-idle"), { method: "POST" });
    return (await this.parseJson(res)) as Lobby[];
  }

  // The host confirms the setup; the post opens the lobby to players.
  async openLobby(lobbyId: string, host: Actor, messageId: string): Promise<Lobby> {
    return this.lobbyCall(`${lobbyId}/live`, "POST", host, { message_id: messageId });
  }

  async joinLobby(lobbyId: string, player: Actor): Promise<Lobby> {
    return this.lobbyCall(`${lobbyId}/join`, "POST", player);
  }

  async leaveLobby(lobbyId: string, player: Actor): Promise<Lobby> {
    return this.lobbyCall(`${lobbyId}/leave`, "POST", player);
  }

  // The host's edit, saved whole.
  async editLobby(lobbyId: string, host: Actor, edit: LobbyEdit): Promise<Lobby> {
    return this.lobbyCall(`${lobbyId}/edit`, "PUT", host, edit);
  }

  // The host starts, or the bot for them once a full lobby's countdown ends:
  // the seats lock and the bans vote opens.
  async startLobby(lobbyId: string, host: Actor): Promise<Lobby> {
    return this.lobbyCall(`${lobbyId}/start`, "POST", host);
  }

  // Where the vote is posted; the bot acts as the host.
  async placeVote(lobbyId: string, host: Actor, place: VotePlace): Promise<Lobby> {
    return this.lobbyCall(`${lobbyId}/vote`, "PUT", host, place);
  }

  async finishVote(lobbyId: string, player: Actor): Promise<Lobby> {
    return this.lobbyCall(`${lobbyId}/finished`, "POST", player);
  }

  // The ban reactions so far: a leader reaching a majority is banned at once.
  async countBallot(lobbyId: string, host: Actor, ballot: LobbyBallot): Promise<Lobby> {
    return this.lobbyCall(`${lobbyId}/ballot`, "POST", host, ballot);
  }

  // The players' ban reactions, counted and the draft dealt; the bot acts as the host.
  async tallyVote(lobbyId: string, host: Actor, ballot: LobbyBallot): Promise<Lobby> {
    return this.lobbyCall(`${lobbyId}/tally`, "POST", host, ballot);
  }

  async pickLeader(lobbyId: string, player: Actor, leader: string): Promise<Lobby> {
    return this.lobbyCall(`${lobbyId}/pick`, "POST", player, { leader });
  }

  // The blind picks revealed together; the bot acts as the host.
  async revealPicks(lobbyId: string, host: Actor): Promise<Lobby> {
    return this.lobbyCall(`${lobbyId}/reveal`, "POST", host);
  }

  // Countdowns, votes and blind picks past their time, left open by a restart.
  async lobbiesDue(): Promise<Lobby[]> {
    const res = await this.fetchWithRetry(this.lobbyUrl("due"), { method: "GET" });
    return (await this.parseJson(res)) as Lobby[];
  }

  // A lobby is cancelled by its code, by its host or by staff.
  async cancelLobby(guildId: string, code: string, actor: Actor): Promise<Lobby> {
    return this.lobbyCall("cancel", "POST", actor, { guild_id: guildId, code });
  }

  async startVote(body: VoteRequest, starter: Actor): Promise<Vote> {
    return this.voteCall("", "POST", starter, body);
  }

  async vote(voteId: string): Promise<Vote> {
    const res = await this.fetchWithRetry(this.voteUrl(voteId), { method: "GET" });
    return (await this.parseJson(res)) as Vote;
  }

  // Where the vote's messages are posted, then the blind picks'; the bot acts as the starter.
  async placeVoteMessages(voteId: string, starter: Actor, place: VoteMessages): Promise<Vote> {
    return this.voteCall(`${voteId}/messages`, "PUT", starter, place);
  }

  async finishVoting(voteId: string, player: Actor): Promise<Vote> {
    return this.voteCall(`${voteId}/finished`, "POST", player);
  }

  // The reactions so far: a setting or ban a majority backs is won at once.
  async countVoteSoFar(voteId: string, starter: Actor, ballot: VoteBallot): Promise<Vote> {
    return this.voteCall(`${voteId}/ballot`, "POST", starter, ballot);
  }

  // Every reaction counted and the draft dealt; the bot acts as the starter.
  async tallyVoteBallot(voteId: string, starter: Actor, ballot: VoteBallot): Promise<Vote> {
    return this.voteCall(`${voteId}/tally`, "POST", starter, ballot);
  }

  async pickInVote(voteId: string, player: Actor, leader: string, civ: string | null): Promise<Vote> {
    return this.voteCall(`${voteId}/pick`, "POST", player, { leader, ...(civ ? { civ } : {}) });
  }

  async revealVotePicks(voteId: string, starter: Actor): Promise<Vote> {
    return this.voteCall(`${voteId}/reveal`, "POST", starter);
  }

  // Votes and blind picks past their time, left open by a restart.
  async votesDue(): Promise<Vote[]> {
    const res = await this.fetchWithRetry(this.voteUrl("due"), { method: "GET" });
    return (await this.parseJson(res)) as Vote[];
  }

  // A vote is cancelled by its code, by its starter or by staff.
  async cancelVote(guildId: string, code: string, actor: Actor): Promise<Vote> {
    return this.voteCall("cancel", "POST", actor, { guild_id: guildId, code });
  }

  private voteUrl(path: string): string {
    return `${this.base}/api/v2/match-setups/votes${path ? `/${path}` : ""}`;
  }

  private voteCall(path: string, method: "POST" | "PUT", actor: Actor, body?: unknown): Promise<Vote> {
    return this.actorCall<Vote>(this.voteUrl(path), method, actor, body);
  }

  private lobbyUrl(path: string): string {
    return `${this.base}/api/v2/match-setups/lobbies${path ? `/${path}` : ""}`;
  }

  private lobbyCall(path: string, method: "POST" | "PUT", actor: Actor, body?: unknown): Promise<Lobby> {
    return this.actorCall<Lobby>(this.lobbyUrl(path), method, actor, body);
  }

  // A match-setup change made as a player, or as the host the bot acts for.
  private async actorCall<T>(url: string, method: "POST" | "PUT", actor: Actor, body?: unknown): Promise<T> {
    const res = await this.fetchWithRetry(url, {
      method,
      headers: body === undefined ? actorHeaders(actor) : { ...json, ...actorHeaders(actor) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return (await this.parseJson(res)) as T;
  }

  // Who may report is core-api's rule; the bot names the uploader.
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

  async withdrawContest(matchId: string, actor: Actor): Promise<Match> {
    const res = await this.fetchWithRetry(`${this.base}/api/v2/matches/${encodeURIComponent(matchId)}/contest`, {
      method: "DELETE",
      headers: actorHeaders(actor),
    });
    return (await this.parseJson(res)) as Match;
  }

  // Approves, as the actor, the reports that need no staff 48 hours after upload.
  async autoApprove(actor: Actor): Promise<Match[]> {
    const res = await this.fetchWithRetry(`${this.base}/api/v2/matches/auto-approve`, {
      method: "POST",
      headers: actorHeaders(actor),
    });
    return (await this.parseJson(res)) as Match[];
  }

  async recordHistoryPost(matchId: string, messageId: string): Promise<void> {
    await this.fetchWithRetry(`${this.base}/api/v2/matches/${encodeURIComponent(matchId)}/history-post`, {
      method: "PUT",
      headers: json,
      body: JSON.stringify({ message_id: messageId }),
    });
  }

  async revert(matchId: string, actor: Actor): Promise<Match> {
    const res = await this.fetchWithRetry(`${this.base}/api/v2/matches/${encodeURIComponent(matchId)}/revert`, {
      method: "POST",
      headers: actorHeaders(actor),
    });
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

  // A second attempt follows core-api's retryable flag on any method. A transport
  // failure may hide a write that landed, so then only a read is sent again.
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