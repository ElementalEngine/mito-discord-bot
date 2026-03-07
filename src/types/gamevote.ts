import type { Guild, Message, SendableChannels, User } from 'discord.js';

import type { VoteQuestion } from '../config/types.js';
import type { DraftGameType } from './draft.js';
import type { CivEdition } from '../config/types.js';
import type { Civ7StartingAge } from '../data/types.js';
import type { VoterUser } from '../utils/types.js';

export type GameVotePhase = 'voting' | 'blind_draft' | 'final';
export type GameVoteStatus = 'active' | 'completed' | 'timed_out';

export type GameVoteDraftMode = 'standard' | 'snake' | 'random' | 'cwc' | 'blind';

export type GameVoteVoter = Readonly<{
  id: string;
  displayName: string;
}>;

export type GameVoteProgress = Readonly<{
  phase: GameVotePhase;
  status: GameVoteStatus;
  voters: readonly GameVoteVoter[];
  totalQuestions: number;
  answeredCountById: ReadonlyMap<string, number>;
  bansSubmittedIds: ReadonlySet<string>;
  finishedIds: ReadonlySet<string>;
  blindDraftPickedIds: ReadonlySet<string>;
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
  voters: readonly VoterUser[];
}>;

export type StartGameVoteResult =
  | Readonly<{ ok: true; sessionId: string }>
  | Readonly<{ ok: false; message: string }>;

export type VoteRecord = Map<string, string>; // voterId -> optionId

export type BanSubmission = Readonly<{
  leaderKeys: readonly string[];
  civKeys?: readonly string[];
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

  phase: GameVotePhase;
  status: GameVoteStatus;
  questions: readonly VoteQuestion[];

  // questionId -> voterId -> optionId
  votesByQuestion: Map<string, VoteRecord>;
  lockedSettings: Map<string, string>; // questionId -> optionId
  tiebrokenQuestions: Set<string>; // questionId

  activeQuestionByVoter: Map<string, string>; // voterId -> questionId

  bansByVoter: Map<string, BanSubmission>;
  bansSubmitted: Set<string>;
  banPages: Map<string, BanPageState>;

  // Voters who have pressed "Finish Vote" in the vote panel.
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
