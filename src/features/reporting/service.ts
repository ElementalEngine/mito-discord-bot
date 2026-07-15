import { HttpClient, downloadAttachment } from "../../core/api/http.js";
import { MatchesApi } from "../../core/api/matches.api.js";
import type { UploadSaveResponse, GetMatchResponse } from "../../core/api/types.js";

const defaultMatches = new MatchesApi(new HttpClient());

export async function submitSaveForReport(
  fileUrl: string,
  filename: string,
  reporterDiscordId: string,
  isCloud: boolean,
  discordMessageId: string,
  matches: MatchesApi = defaultMatches,
  downloader: (url: string) => Promise<Buffer> = downloadAttachment,
): Promise<UploadSaveResponse> {
  const buf = await downloader(fileUrl);
  return matches.uploadSave(buf, filename, reporterDiscordId, isCloud, discordMessageId);
}

export async function appendMessageIdList(
  matchId: string,
  messageIdList: string[],
  matches: MatchesApi = defaultMatches,
) : Promise<GetMatchResponse> {
  return matches.appendMessageIdList(matchId, messageIdList);
}

export async function setPlayerOrder(
  matchId: string,
  playerOrder: string,
  discordMessageId: string,
  matches: MatchesApi = defaultMatches,
) : Promise<GetMatchResponse> {
  return matches.setPlayerOrder(matchId, playerOrder, discordMessageId);
}

export async function setPlacements(
  matchId: string,
  newOrder: string,
  discordMessageId: string,
  matches: MatchesApi = defaultMatches,
) : Promise<GetMatchResponse> {
  return matches.changeOrder(matchId, newOrder, discordMessageId);
}

export async function getMatch(
  matchId: string,
  matches: MatchesApi = defaultMatches,
) : Promise<GetMatchResponse> {
  return matches.getMatch(matchId);
}

export async function deletePendingMatch(
  matchId: string,
  matches: MatchesApi = defaultMatches,
) : Promise<GetMatchResponse> {
  return matches.deletePendingMatch(matchId);
}

export async function triggerQuit(
  matchId: string,
  quitterDiscordId: string,
  discordMessgeId: string,
  matches: MatchesApi = defaultMatches,
) : Promise<GetMatchResponse> {
  return matches.triggerQuit(matchId, quitterDiscordId, discordMessgeId);
}

export async function assignDiscordId(
  matchId: string,
  playerId: string,
  playerDiscordId: string,
  discordMessageId: string,
  matches: MatchesApi = defaultMatches,
) : Promise<GetMatchResponse> {
  return matches.assignDiscordId(matchId, playerId, playerDiscordId, discordMessageId);
}

export async function assignDiscordIdAll(
  matchId: string,
  discordIdList: string[],
  discordMessageId: string,
  matches: MatchesApi = defaultMatches,
) : Promise<GetMatchResponse> {
  return matches.assignDiscordIdAll(matchId, discordIdList, discordMessageId);
}

export async function assignSub(
  matchId: string,
  subInId: string,
  subOutDiscordId: string,
  discordMessageId: string,
  matches: MatchesApi = defaultMatches,
) : Promise<GetMatchResponse> {
  return matches.assignSub(matchId, subInId, subOutDiscordId, discordMessageId);
}

export async function removeSub(
  matchId: string,
  subOutId: string,
  discordMessageId: string,
  matches: MatchesApi = defaultMatches,
) : Promise<GetMatchResponse> {
  return matches.removeSub(matchId, subOutId, discordMessageId);
}

export async function approveMatch(
  matchId: string,
  approverDiscordId: string,
  matches: MatchesApi = defaultMatches,
) : Promise<GetMatchResponse> {
  return matches.approveMatch(matchId, approverDiscordId);
}


export async function contestReport(
  matchId: string,
  contesterDiscordId: string,
  reason: string,
  discordMessageId: string,
  matches: MatchesApi = defaultMatches,
) : Promise<GetMatchResponse> {
  return matches.contestReport(matchId, contesterDiscordId, reason, discordMessageId);
}

export async function revertMatch(
  matchId: string,
  matches: MatchesApi = defaultMatches,
) : Promise<GetMatchResponse> {
  return matches.revertMatch(matchId);
}