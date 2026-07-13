import type { EmbedBuilder, Message, SendableChannels, User } from 'discord.js';

import type { CivEdition } from '../config/types.js';
import type { Civ7StartingAge } from '../data/types.js';
import type { DraftGameType, DraftMode } from '../shared/draft.types.js';

export { DRAFT_GAME_TYPES, DRAFT_MODES } from '../shared/draft.types.js';
export type {
  Civ6DraftRequest,
  Civ6DraftResult,
  Civ7DraftRequest,
  Civ7DraftResult,
  DraftAllocation,
  DraftGameType,
  DraftGroup,
  DraftGroupKind,
  DraftMode,
} from '../shared/draft.types.js';

export type DraftCommandRequest = Readonly<{
  source: 'command';
  edition: CivEdition;
  draftMode: 'standard';
  gameType: DraftGameType;
  startingAge?: Civ7StartingAge;
  numberPlayers?: number;
  numberTeams?: number;
  leaderBansRaw?: string;
  civBansRaw?: string;
}>;

export type VoteDraftRequest = Readonly<{
  source: 'vote';
  edition: CivEdition;
  draftMode: DraftMode;
  gameType: DraftGameType;
  startingAge?: Civ7StartingAge;
  numberPlayers?: number;
  numberTeams?: number;
  voterIds: readonly string[];
  voteUuid: string;
  commandChannel: SendableChannels;
  hostId: string;
  bannedLeaderKeys: readonly string[];
  bannedCivKeys: readonly string[];
  voterUsersById?: ReadonlyMap<string, User>;
  publicMessage?: Message<true>;
}>;

export type DraftRequest = DraftCommandRequest | VoteDraftRequest;

export type DraftMessagePayload = Readonly<{
  content?: string;
  embeds?: readonly EmbedBuilder[];
  allowedMentions?: Readonly<{ parse: readonly [] }>;
}>;

export type DraftModeOutput = DraftMessagePayload &
  Readonly<{
    followUps?: readonly DraftMessagePayload[];
  }>;

export type BlindDraftPools = Readonly<{
  civs?: readonly string[];
  leaders: readonly string[];
}>;

export type BlindDraftPick = {
  civKey?: string;
  leaderKey?: string;
  defaulted?: boolean;
};

export type BlindDraftPageState = Readonly<{
  civPage: number;
  leaderPage: number;
}>;

export type BlindDraftAssignment = Readonly<{
  voterId: string;
  leaders: readonly string[];
  civs?: readonly string[];
}>;

export type BlindDraftLaunch =
  | Readonly<{ ok: true; assignments: readonly BlindDraftAssignment[] }>
  | Readonly<{ ok: false; message: string }>;

export type BlindDraftSession = {
  sessionId: string;
  edition: CivEdition;
  voterIds: readonly string[];
  commandChannel: SendableChannels;
  voterUsersById: ReadonlyMap<string, User>;
  voteMessage?: Message<true>;
  trackingMessage: Message | null;
  dmMessages: Map<string, Message<false>>;
  endsAtMs: number;
  timeout: NodeJS.Timeout | null;
  pools: Map<string, BlindDraftPools>;
  picks: Map<string, BlindDraftPick>;
  stagedPicks: Map<string, BlindDraftPick>;
  voteUuid?: string;
  pages: Map<string, BlindDraftPageState>;
  phase: 'collecting' | 'finalizing' | 'closed';
  trackingRenderChain: Promise<void> | null;
};

export type SnakeRoundKind = 'leader' | 'civ' | 'complete';

export type SnakeDraftPick = Readonly<{
  leaderKey?: string;
  civKey?: string;
}>;

export type SnakeDraftPageState = Readonly<{
  leaderPage: number;
  civPage: number;
}>;

export type SnakeDraftSession = {
  sessionId: string;
  edition: CivEdition;
  startingAge?: string;
  voterIds: readonly string[];
  order: readonly string[];
  civOrder: readonly string[];
  commandChannel: SendableChannels;
  voterUsersById: ReadonlyMap<string, User>;
  trackingMessage: Message | null;
  dmMessages: Map<string, Message<false>>;
  leaderPool: readonly string[];
  civPool: readonly string[];
  picks: Map<string, SnakeDraftPick>;
  stagedPicks: Map<string, SnakeDraftPick>;
  pages: Map<string, SnakeDraftPageState>;
  round: SnakeRoundKind;
  turnIndex: number;
  turnToken: number;
  turnEndsAtMs: number;
  timeout: NodeJS.Timeout | null;
  lastEvent?: string;
  voteUuid?: string;
};

export type CwcRoundKind = 'captains' | 'leader' | 'civ' | 'complete';

export type CwcDraftPageState = Readonly<{
  leaderPage: number;
  civPage: number;
}>;

export type CwcTeamPicks = {
  leaders: string[];
  civs: string[];
};

export type CwcDraftSession = {
  sessionId: string;
  edition: CivEdition;
  startingAge?: string;
  hostId: string;
  voterIds: readonly string[];
  commandChannel: SendableChannels;
  voterUsersById: ReadonlyMap<string, User>;
  trackingMessage: Message | null;
  captainIds: [string | null, string | null];
  pages: Map<string, CwcDraftPageState>;
  leaderPool: readonly string[];
  civPool: readonly string[];
  picks: [CwcTeamPicks, CwcTeamPicks];
  pickOrder: readonly number[];
  round: CwcRoundKind;
  turnIndex: number;
  turnToken: number;
  turnEndsAtMs: number;
  timeout: NodeJS.Timeout | null;
  lastEvent?: string;
  voteUuid?: string;
};
