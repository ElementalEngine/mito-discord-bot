import type { Guild, Message, SendableChannels, User } from 'discord.js';
import type { VoterUser } from '../utils/types.js';

export type SecretVoteAction = 'CC' | 'Remap' | 'Scrap' | 'Irrel';
export type SecretVoteChoice = 'YES' | 'NO';

export type StartSecretVoteOptions = Readonly<{
  guild: Guild;
  commandChannel: SendableChannels;
  voiceChannelId: string;
  host: User;
  action: SecretVoteAction;
  turn: number;
  details: string;
  voters: readonly VoterUser[];
}>;

export type SecretVoteOutcome = Readonly<{
  yes: number;
  no: number;
  outcome: 'PASSED' | 'FAILED';
  nonVoterIds: readonly string[];
  rule: string;
  notes?: readonly string[];
}>;

export type SecretVoteStatus = Readonly<{
  voteId: string;
  action: SecretVoteAction;
  turn: number;
  details: string;
  hostId: string;
  startedAtMs: number;
  endsAtMs: number;
  voters: readonly { id: string; displayName: string }[];
  votedIds: ReadonlySet<string>;
  awaitingIds: ReadonlySet<string>;
  isFinal: boolean;
  result?: SecretVoteOutcome;
}>;

export type SecretVoteButtonId = Readonly<{
  voteId: string;
  voterId: string;
  choice: SecretVoteChoice;
}>;

export type SecretVoteSession = {
  voteId: string;
  guildId: string;
  voiceChannelId: string;

  hostId: string;
  action: SecretVoteAction;
  turn: number;
  details: string;

  voters: readonly { id: string; displayName: string }[];
  startedAtMs: number;
  endsAtMs: number;

  awaiting: Set<string>;
  votes: Map<string, SecretVoteChoice>;
  dmMessages: Map<string, Message<false>>;
  publicMessage: Message<true>;

  timeout: NodeJS.Timeout;
  editInFlight: boolean;
  needsRender: boolean;
  pendingStatus: SecretVoteStatus | null;
  isFinalized: boolean;
};

type StartSecretVoteOk = Readonly<{
  ok: true;
  voteId: string;
  publicMessageUrl: string;
}>;

type StartSecretVoteErr =
  | Readonly<{ ok: false; kind: 'ACTIVE_VOTE'; message: string }>
  | Readonly<{ ok: false; kind: 'DM_BLOCKED'; message: string }>
  | Readonly<{ ok: false; kind: 'SEND_FAILED'; message: string }>
  | Readonly<{ ok: false; kind: 'TOO_FEW_VOTERS'; message: string }>;

export type StartSecretVoteResult = StartSecretVoteOk | StartSecretVoteErr;