import type { Guild, SendableChannels, User } from 'discord.js';

export type SecretVoteAction = 'CC' | 'Remap' | 'Scrap' | 'Irrel';
export type SecretVoteChoice = 'YES' | 'NO';

export type VoterUser = Readonly<{
  id: string;
  displayName: string;
  user: User;
}>;

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
  /** Optional render time for deterministic timer display. */
  nowMs?: number;
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
