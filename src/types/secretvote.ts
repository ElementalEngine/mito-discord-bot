import type { Guild, SendableChannels, User } from 'discord.js';

import type { VoterUser } from './voice-voters.js';

export type SecretVoteAction = 'CC' | 'Remap' | 'Scrap';

export type SecretVoteChoice = 'YES' | 'NO';

export type SecretVoteButtonId = Readonly<{
  voteId: string;
  voterId: string;
  choice: SecretVoteChoice;
}>;

export type SecretVoteOutcome = Readonly<{
  yes: number;
  no: number;
  outcome: 'PASSED' | 'FAILED';
  nonVoterIds: readonly string[];
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

type StartSecretVoteOk = Readonly<{
  ok: true;
  voteId: string;
  publicMessageUrl: string;
}>;

type StartSecretVoteErr =
  | Readonly<{ ok: false; kind: 'ACTIVE_VOTE'; message: string }>
  | Readonly<{ ok: false; kind: 'DM_BLOCKED'; message: string }>
  | Readonly<{ ok: false; kind: 'SEND_FAILED'; message: string }>;

export type StartSecretVoteResult = StartSecretVoteOk | StartSecretVoteErr;