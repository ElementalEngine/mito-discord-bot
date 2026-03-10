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
export type {
  DraftGameType,
  DraftMode,
  Civ6DraftRequest,
  Civ7DraftRequest,
  DraftAllocation,
  DraftGroup,
  DraftGroupKind,
  Civ6DraftResult,
  Civ7DraftResult,
  DraftCommandRequest,
  VoteDraftRequest,
  DraftRequest,
} from './draft.types.js';

export {
  DRAFT_GAME_TYPES,
  DRAFT_MODES,
} from './draft.types.js';

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
  DraftMessagePayload,
  DraftModeOutput,
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
