import type { HttpClient } from "./http.js";
import type { UploadSaveResponse, GetMatchResponse } from "./types.js";

/** Match save/lifecycle/reporting calls. Method bodies verbatim from the legacy ApiClient (wire contract frozen). */
export class MatchesApi {
  readonly http: HttpClient;

  constructor(http: HttpClient) {
    this.http = http;
  }

  async uploadSave(fileBuf: Buffer, filename: string, reporterDiscordId: string, isCloud: boolean, discordMessageId: string): Promise<UploadSaveResponse> {
    const form = new FormData();
    // TS typing-safe for Node: wrap Buffer in Uint8Array for File/Blob
    form.append("file", new File([new Uint8Array(fileBuf)], filename));
    form.append("reporter_discord_id", reporterDiscordId);
    form.append("is_cloud", isCloud ? "1" : "0");
    form.append("discord_message_id", discordMessageId);

    const res = await this.http.fetchWithRetry(`${this.http.base}/api/v1/upload-game-report/`, {
      method: "POST",
      body: form,
    });

    return (await this.http.parseJson(res)) as UploadSaveResponse;
  }

  async appendMessageIdList(matchId: string, messageIdList: string[]): Promise<UploadSaveResponse> {
    const form = new FormData();
    form.append("match_id", matchId);
    for (const msgId of messageIdList) {
      form.append("discord_message_id", msgId);
    }
    const res = await this.http.fetchWithRetry(`${this.http.base}/api/v1/append-message-id-list/`, {
      method: "PUT",
      body: form,
    });
    return (await this.http.parseJson(res)) as UploadSaveResponse;
  }

  async setPlayerOrder(matchId: string, playerOrder: string, discordMessageId: string): Promise<GetMatchResponse> {
    const form = new FormData();
    form.append("match_id", matchId);
    form.append("player_order", playerOrder);
    form.append("discord_message_id", discordMessageId);

    const res = await this.http.fetchWithRetry(`${this.http.base}/api/v1/set-player-order/`, {
      method: "PUT",
      body: form,
    });

    return (await this.http.parseJson(res)) as GetMatchResponse;
  }

  async changeOrder(matchId: string, newOrder: string, discordMessageId: string): Promise<GetMatchResponse> {
    const form = new FormData();
    form.append("match_id", matchId);
    form.append("new_order", newOrder);
    form.append("discord_message_id", discordMessageId);

    const res = await this.http.fetchWithRetry(`${this.http.base}/api/v1/change-order/`, {
      method: "PUT",
      body: form,
    });

    return (await this.http.parseJson(res)) as GetMatchResponse;
  }

  async deletePendingMatch(matchId: string): Promise<GetMatchResponse> {
    const form = new FormData();
    form.append("match_id", matchId);

    const res = await this.http.fetchWithRetry(`${this.http.base}/api/v1/delete-pending-match/`, {
      method: "PUT",
      body: form
    });

    return (await this.http.parseJson(res)) as GetMatchResponse;
  }

  async getMatch(matchId: string): Promise<GetMatchResponse> {
    const form = new FormData();
    form.append("match_id", matchId);

    const res = await this.http.fetchWithRetry(`${this.http.base}/api/v1/get-match/`, {
      method: "PUT",
      body: form
    });

    return (await this.http.parseJson(res)) as GetMatchResponse;
  }

  async triggerQuit(matchId: string, quitterDiscordId: string, discordMessgeId: string): Promise<GetMatchResponse> {
    const form = new FormData();
    form.append("match_id", matchId);
    form.append("quitter_discord_id", quitterDiscordId);
    form.append("discord_message_id", discordMessgeId);

    const res = await this.http.fetchWithRetry(`${this.http.base}/api/v1/trigger-quit/`, {
      method: "PUT",
      body: form,
    });

    return (await this.http.parseJson(res)) as GetMatchResponse;
  }

  async assignDiscordId(matchId: string, playerId: string, playerDiscordId: string, discordMessageId: string): Promise<GetMatchResponse> {
    const form = new FormData();
    form.append("match_id", matchId);
    form.append("player_id", playerId);
    form.append("player_discord_id", playerDiscordId);
    form.append("discord_message_id", discordMessageId);

    const res = await this.http.fetchWithRetry(`${this.http.base}/api/v1/assign-discord-id/`, {
      method: "PUT",
      body: form,
    });

    return (await this.http.parseJson(res)) as GetMatchResponse;
  }

  async assignDiscordIdAll(matchId: string, discordIdList: string[], discordMessageId: string): Promise<GetMatchResponse> {
    const form = new FormData();
    form.append("match_id", matchId);
    for (const discordId of discordIdList) {
      form.append("discord_id_list", discordId);
    }
    form.append("discord_message_id", discordMessageId);

    const res = await this.http.fetchWithRetry(`${this.http.base}/api/v1/assign-discord-id-all/`, {
      method: "PUT",
      body: form,
    });

    return (await this.http.parseJson(res)) as GetMatchResponse;
  }

  async assignSub(matchId: string, subInId: string, subOutDiscordId: string, discordMessageId: string): Promise<GetMatchResponse> {
    const form = new FormData();
    form.append("match_id", matchId);
    form.append("sub_in_id", subInId);
    form.append("sub_out_discord_id", subOutDiscordId);
    form.append("discord_message_id", discordMessageId);

    const res = await this.http.fetchWithRetry(`${this.http.base}/api/v1/assign-sub/`, {
      method: "PUT",
      body: form,
    });

    return (await this.http.parseJson(res)) as GetMatchResponse;
  }

  async removeSub(matchId: string, subOutId: string, discordMessageId: string): Promise<GetMatchResponse> {
    const form = new FormData();
    form.append("match_id", matchId);
    form.append("sub_out_id", subOutId);
    form.append("discord_message_id", discordMessageId);

    const res = await this.http.fetchWithRetry(`${this.http.base}/api/v1/remove-sub/`, {
      method: "PUT",
      body: form,
    });

    return (await this.http.parseJson(res)) as GetMatchResponse;
  }

  async approveMatch(matchId: string, approverDiscordId: string): Promise<GetMatchResponse> {
    const form = new FormData();
    form.append("match_id", matchId);
    form.append("approver_discord_id", approverDiscordId);

    const res = await this.http.fetchWithRetry(`${this.http.base}/api/v1/approve-match/`, {
      method: "PUT",
      body: form,
    });

    return (await this.http.parseJson(res)) as GetMatchResponse;
  }

  async contestReport(matchId: string, contestorDiscordId: string, reason: string, discordMessageId: string): Promise<GetMatchResponse> {
    const form = new FormData();
    form.append("match_id", matchId);
    form.append("contestor_discord_id", contestorDiscordId);
    form.append("reason", reason);
    form.append("discord_message_id", discordMessageId);

    const res = await this.http.fetchWithRetry(`${this.http.base}/api/v1/contest-report/`, {
      method: "PUT",
      body: form,
    });

    return (await this.http.parseJson(res)) as GetMatchResponse;
  }

  async revertMatch(matchId: string): Promise<GetMatchResponse> {
    const form = new FormData();
    form.append("match_id", matchId);

    const res = await this.http.fetchWithRetry(`${this.http.base}/api/v1/revert-match/`, {
      method: "PUT",
      body: form,
    });

    return (await this.http.parseJson(res)) as GetMatchResponse;
  }
}
