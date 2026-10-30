import type { components } from '@cpl/contracts';
import type { CivEdition } from '../config/constants.js';
export type GameMode = 'realtime' | 'cloud';

export type LeaderboardRanking = components['schemas']['LeaderboardRankingResponse'];

// ── Stats (/api/v2/stats)

export type CivVersion = Lowercase<CivEdition>;
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
export type DraftRequest = components['schemas']['DraftRequest'];
export type DraftDeal = components['schemas']['DraftDeal'];

// A hosted lobby, from host to draft, and the settings its host may fix.
export type LobbyRequest = components['schemas']['LobbyRequest'];
export type LobbyShape = LobbyRequest['shape'];
export type Lobby = components['schemas']['LobbyView'];
export type LobbyEdit = components['schemas']['LobbyEdit'];
export type LobbyBallot = components['schemas']['LobbyBallot'];
export type VotePlace = components['schemas']['VotePlace'];
export type SettingQuestion = components['schemas']['SettingQuestion'];

// A /vote, from its players' reactions to the draft.
export type VoteRequest = components['schemas']['VoteRequest'];
export type Vote = components['schemas']['VoteView'];
export type VoteBallot = components['schemas']['VoteBallot'];
export type VoteMessages = components['schemas']['VoteMessages'];

// The v2 match surface, as core-api declares it.
export type Match = components['schemas']['MatchResponse'];
export type AffectedPlayerRating = components['schemas']['AffectedPlayerRating'];
export type MatchUpload = components['schemas']['UploadResponse'];
export type SeatEdit = components['schemas']['SeatPatchIn'];
export type SubQuota = components['schemas']['SubQuotaResponse'];

// Who is acting. Staff is the bot's assertion, sent only when true.
export type Actor = Readonly<{ id: string; isStaff?: boolean }>;
