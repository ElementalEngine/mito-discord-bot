// Core-owned type re-exports (single source of truth)
export type {
  CivEdition,
  DraftModeId,
  GameVoteConfig,
  VoteEmoji,
  VoteOption,
  VoteQuestion,
} from '../config/types.js';

export type {
  AgePool,
  Civ6LeaderKey,
  Civ7CivKey,
  Civ7LeaderKey,
  Civ7StartingAge,
  CivMeta,
  LeaderMeta,
  LeaderType,
} from '../data/types.js';

export type {
  BuildVoiceChannelVotersResult,
  CommandAccessPolicy,
  VoterUser,
} from '../utils/types.js';

// Feature/domain types (commands/services/ui)
export type { DraftGameType } from './drafting.types.js';
export type {
  Civ6DraftRequest,
  Civ7DraftRequest,
  DraftAllocation,
  DraftGroup,
  DraftGroupKind,
  Civ6DraftResult,
  Civ7DraftResult,
} from './drafting.types.js';

export type {
  BanSubmission,
  GameVoteDraftMode,
  GameVotePhase,
  GameVoteProgress,
  GameVoteStatus,
  GameVoteSession,
  GameVoteSessionSeed,
  GameVoteVoter,
  StartGameVoteOptions,
  StartGameVoteResult,
  VoteRecord,
} from './voting.types.js';

export type {
  SecretVoteAction,
  SecretVoteButtonId,
  SecretVoteChoice,
  SecretVoteOutcome,
  SecretVoteSession,
  SecretVoteSessionPhase,
  SecretVoteStatus,
  StartSecretVoteOptions,
  StartSecretVoteResult,
} from './secretvote.types.js';

export type {
  BlindDraftAssignment,
  BlindDraftLaunch,
  BlindDraftPageState,
  BlindDraftPick,
  BlindDraftPools,
  CwcDraftPageState,
  CwcDraftSession,
  CwcRoundKind,
  CwcTeamPicks,
  DraftMessagePayload,
  DraftModeOutput,
  SnakeDraftPageState,
  SnakeDraftPick,
  SnakeDraftSession,
  SnakeRoundKind,
} from './drafting.types.js';

export type { Leaderboard } from '../data/types.js';

export type {
  BaseReport,
  Civ6Player,
  Civ7Player,
  Civ6Report,
  Civ7Report,
  GameMode,
} from './reporting.types.js';