import type {
  UploadSaveResponse,
  GetMatchResponse,
  LeaderboardRanking,
} from "../api/index.js";
import { ApiClient } from "../api/index.js";
import { downloadAttachment } from "../utils/download-attachment.js";

export async function submitSaveForReport(
  fileUrl: string,
  filename: string,
  reporterDiscordId: string,
  isCloud: boolean,
  discordMessageId: string,
  api: ApiClient = new ApiClient(),
  downloader: (url: string) => Promise<Buffer> = downloadAttachment,
): Promise<UploadSaveResponse> {
  const buf = await downloader(fileUrl);
  return api.uploadSave(buf, filename, reporterDiscordId, isCloud, discordMessageId);
}

export async function appendMessageIdList(
  matchId: string,
  messageIdList: string[],
  api: ApiClient = new ApiClient(),
) : Promise<GetMatchResponse> {
  return api.appendMessageIdList(matchId, messageIdList);
}

export async function setPlayerOrder(
  matchId: string,
  playerOrder: string,
  discordMessageId: string,
  api: ApiClient = new ApiClient(),
) : Promise<GetMatchResponse> {
  return api.setPlayerOrder(matchId, playerOrder, discordMessageId);
}

export async function setPlacements(
  matchId: string,
  newOrder: string,
  discordMessageId: string,
  api: ApiClient = new ApiClient(),
) : Promise<GetMatchResponse> {
  return api.changeOrder(matchId, newOrder, discordMessageId);
}

export async function getMatch(
  matchId: string,
  api: ApiClient = new ApiClient(),
) : Promise<GetMatchResponse> {
  return api.getMatch(matchId);
}

export async function deletePendingMatch(
  matchId: string,
  api: ApiClient = new ApiClient(),
) : Promise<GetMatchResponse> {
  return api.deletePendingMatch(matchId);
}

export async function triggerQuit(
  matchId: string,
  quitterDiscordId: string,
  discordMessgeId: string,
  api: ApiClient = new ApiClient(),
) : Promise<GetMatchResponse> {
  return api.triggerQuit(matchId, quitterDiscordId, discordMessgeId);
}

export async function assignDiscordId(
  matchId: string,
  playerId: string,
  playerDiscordId: string,
  discordMessageId: string,
  api: ApiClient = new ApiClient(),
) : Promise<GetMatchResponse> {
  return api.assignDiscordId(matchId, playerId, playerDiscordId, discordMessageId);
}

export async function assignDiscordIdAll(
  matchId: string,
  discordIdList: string[],
  discordMessageId: string,
  api: ApiClient = new ApiClient(),
) : Promise<GetMatchResponse> {
  return api.assignDiscordIdAll(matchId, discordIdList, discordMessageId);
}

export async function assignSub(
  matchId: string,
  subInId: string,
  subOutDiscordId: string,
  discordMessageId: string,
  api: ApiClient = new ApiClient(),
) : Promise<GetMatchResponse> {
  return api.assignSub(matchId, subInId, subOutDiscordId, discordMessageId);
}

export async function removeSub(
  matchId: string,
  subOutId: string,
  discordMessageId: string,
  api: ApiClient = new ApiClient(),
) : Promise<GetMatchResponse> {
  return api.removeSub(matchId, subOutId, discordMessageId);
}

export async function approveMatch(
  matchId: string,
  approverDiscordId: string,
  api: ApiClient = new ApiClient(),
) : Promise<GetMatchResponse> {
  return api.approveMatch(matchId, approverDiscordId);
}

export async function getLeaderboardRanking(
  game: string,
  gameType: string,
  gameMode: string,
  isSeasonal: boolean,
  isCombined: boolean,
  api: ApiClient = new ApiClient(),
) : Promise<LeaderboardRanking> {
  return api.getLeaderboardRanking(game, gameType, gameMode, isSeasonal, isCombined);
}

// Future (add here when ready):
// export async function confirmMatch(...) { ... }
// export async function flagMatch(...) { ... }
// export async function approveEligible(...) { ... }