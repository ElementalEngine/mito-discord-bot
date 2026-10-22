import type { LeaderboardRanking } from "../api/index.js";
import { ApiClient } from "../api/index.js";

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
