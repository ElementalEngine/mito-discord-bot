import type { Guild, Message, SendableChannels, User } from 'discord.js';

import type { VoteQuestion } from '../config/types.js';
import type { DraftGameType } from './draft.js';
import type { CivEdition } from '../config/types.js';
import type { Civ7StartingAge } from '../data/types.js';
import type { VoterUser } from '../utils/types.js';

export type GameVotePhase = 'voting' | 'blind_draft' | 'final';
export type GameVoteStatus = 'in_progress' | 'completed' | 'closed';

export type GameVoteDraftMode = 'standard' | 'snake' | 'random' | 'cwc' | 'blind';

export type GameVoteVoter = Readonly<{
  id: string;
  displayName: string;
}>;

export type GameVoteProgress = Readonly<{
  edition: CivEdition;
  status: GameVoteStatus;
  voters: readonly GameVoteVoter[];
  totalQuestions: number;
  answeredCountById: ReadonlyMap<string, number>;
  voteSubmittedIds: ReadonlySet<string>;
  leaderBanCountById: ReadonlyMap<string, number>;
  civBanCountById: ReadonlyMap<string, number>;
  finishedIds: ReadonlySet<string>;
}>;

export type GameVoteSessionSeed = Readonly<{
  edition: CivEdition;
  gameType: DraftGameType;
  startingAge?: Civ7StartingAge;
  numberTeams?: number;
  hostId: string;
  voters: readonly GameVoteVoter[];
  questions: readonly VoteQuestion[];
}>;

export type StartGameVoteOptions = Readonly<{
  guild: Guild;
  commandChannel: SendableChannels;
  voiceChannelId: string;
  host: User;
  edition: CivEdition;
  gameType: DraftGameType;
  startingAge?: Civ7StartingAge;
  numberTeams?: number;
  blindMode?: boolean;
  voters: readonly VoterUser[];
}>;

export type StartGameVoteResult =
  | Readonly<{ ok: true; sessionId: string }>
  | Readonly<{ ok: false; message: string }>;

export type VoteRecord = Map<string, string>;

export type BanSubmission = Readonly<{
  leaderKeys: readonly string[];
  civKeys: readonly string[];
}>;

export type StagedVoteRecord = ReadonlyMap<string, string>;

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

export type BanPageState = Readonly<{
  civPage: number;
  leaderPage: number;
}>;

export type GameVoteSession = {
  sessionId: string;
  guildId: string;
  voiceChannelId: string;
  commandChannel: SendableChannels;

  hostId: string;
  edition: CivEdition;
  gameType: DraftGameType;
  startingAge?: Civ7StartingAge;
  numberTeams?: number;

  voters: readonly GameVoteVoter[];
  voterIds: readonly string[];
  voterUsersById: Map<string, User>;

  startedAtMs: number;
  endsAtMs: number;

  status: GameVoteStatus;
  phase: GameVotePhase;
  questions: readonly VoteQuestion[];

  votesByQuestion: Map<string, VoteRecord>;
  lockedSettings: Map<string, string>;
  tiebrokenQuestions: Set<string>;

  activeQuestionByVoter: Map<string, string>;

  bansByVoter: Map<string, BanSubmission>;
  stagedBansByVoter: Map<string, BanSubmission>;
  bansSubmitted: Set<string>;
  banPages: Map<string, BanPageState>;

  voteSubmitted: Set<string>;
  stagedVotesByVoter: Map<string, VoteRecord>;
  finished: Set<string>;

  publicMessage: Message<true>;
  dmMessages: Map<string, Message<false>>;

  timeout: NodeJS.Timeout | null;
  isFinalized: boolean;

  blindDraftEndsAtMs: number | null;
  blindDraftTimeout: NodeJS.Timeout | null;
  blindDraftPools: Map<string, BlindDraftPools>;
  blindDraftPicks: Map<string, BlindDraftPick>;
  blindDraftPages: Map<string, BlindDraftPageState>;
};
