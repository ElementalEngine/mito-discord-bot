import type { Guild, Message, SendableChannels, User } from 'discord.js';

import type { VoteQuestion } from './config.js';
import type { DraftGameType } from './draft.js';
import type { CivEdition, Civ7StartingAge } from './data.js';
import type { VoterUser } from './utils.js';

export type GameVotePhase = 'voting' | 'bans' | 'blind_draft' | 'final';

export type GameVoteDraftMode = 'standard' | 'snake' | 'random' | 'cwc';

export type GameVoteVoter = Readonly<{
  id: string;
  displayName: string;
}>;

export type GameVoteProgress = Readonly<{
  phase: GameVotePhase;
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
  blindMode: boolean;
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
  blindMode: boolean;
  voters: readonly VoterUser[];
}>;

export type StartGameVoteResult =
  | Readonly<{ ok: true; sessionId: string }>
  | Readonly<{ ok: false; message: string }>;

export type VoteRecord = Map<string, string>; // voterId -> optionId

export type BanSubmission = Readonly<{
  leaderRaw: string;
  civRaw?: string;
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
  blindMode: boolean;

  voters: readonly GameVoteVoter[];
  voterIds: readonly string[];

  startedAtMs: number;
  endsAtMs: number;

  phase: GameVotePhase;
  questions: readonly VoteQuestion[];
  questionIndex: number;
  // questionId -> voterId -> optionId
  votesByQuestion: Map<string, VoteRecord>;
  lockedSettings: Map<string, string>; // questionId -> optionId

  bansByVoter: Map<string, BanSubmission>;
  bansSubmitted: Set<string>;
  finished: Set<string>;

  publicMessage: Message<true>;
  dmMessages: Map<string, Message<false>>;

  timeout: NodeJS.Timeout;
  isFinalized: boolean;
  blindDraftEndsAtMs: number | null;
  blindDraftTimeout: NodeJS.Timeout | null;
  blindDraftPools: Map<string, BlindDraftPools>;
  blindDraftPicks: Map<string, BlindDraftPick>;
};
