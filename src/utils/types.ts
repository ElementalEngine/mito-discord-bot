import type { User } from 'discord.js';

export type VoterUser = Readonly<{
  id: string;
  displayName: string;
  user: User;
}>;

export type BuildVoiceChannelVotersResult = Readonly<{
  voters: VoterUser[];
}>;

export type { CommandAccessPolicy } from '../core/discord/index.js';