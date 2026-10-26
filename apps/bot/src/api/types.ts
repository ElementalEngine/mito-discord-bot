import type { components } from '@cpl/contracts';
import type { CivEdition } from '../config/types.js';
export type GameMode = 'realtime' | 'cloud';
export type Edition = CivEdition;

export type LeaderboardRanking = components['schemas']['LeaderboardRankingResponse'];

// ── Stats (/api/v2/stats)

export type CivVersion = Lowercase<Edition>;
export type StatsGameType = GameMode;
export type StatRow = components['schemas']['StatRowV2'];
export type StatSet = components['schemas']['StatSetV2'];
export type UserStatsResponse = components['schemas']['UserStatsResponseV2'];
export type BatchStatsResponse = components['schemas']['BatchStatsResponseV2'];
export type TeamGenResponse = components['schemas']['TeamGenResponse'];
export type StatsSummary = components['schemas']['StatsSummary'];
export type ResetStatsResponse = components['schemas']['ResetStatsResponseV2'];
export type SeasonPreview = components['schemas']['SeasonPreview'];
export type SeasonRolled = components['schemas']['SeasonRolled'];
export type HistoryPage = components['schemas']['HistoryPage'];
export type HistoryGame = components['schemas']['HistoryGame'];

// One edition's leaders and civs, as core-api serves them.
export type CivDataResponse = components['schemas']['CivDataResponse'];
export type DealRequest = components['schemas']['DealRequest'];
export type DealResponse = components['schemas']['DealResponse'];

// The v2 match surface, as core-api declares it.
export type Match = components['schemas']['MatchResponse'];
export type MatchUpload = components['schemas']['UploadResponse'];
export type SeatEdit = components['schemas']['SeatPatchIn'];
export type SubQuota = components['schemas']['SubQuotaResponse'];

// Who is acting. Staff is the bot's assertion, sent only when true.
export type Actor = Readonly<{ id: string; isStaff?: boolean }>;
