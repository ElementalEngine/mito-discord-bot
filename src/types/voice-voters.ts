import type { User } from 'discord.js';

export type VoterUser = Readonly<{
  id: string;
  displayName: string;
  user: User;
}>;

export type MentionAdjustmentResult = Readonly<{
  voterIds: string[];
  removedIds: string[];
  addedIds: string[];
}>;

export type BuildVoterListResult = Readonly<{
  voters: VoterUser[];
  removedIds: string[];
  addedIds: string[];
}>;
