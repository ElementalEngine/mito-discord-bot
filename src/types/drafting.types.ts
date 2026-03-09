import type { EmbedBuilder, Message, SendableChannels, User } from 'discord.js';

import type { CivEdition } from '../config/types.js';

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
  pages: Map<string, BlindDraftPageState>;
};
