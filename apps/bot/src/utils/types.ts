import type { User } from 'discord.js';

export type VoterUser = Readonly<{
  id: string;
  displayName: string;
  user: User;
}>;

export type BuildVoiceChannelVotersResult = Readonly<{
  voters: VoterUser[];
}>;

export type CommandAccessPolicy = Readonly<{
  allowedChannelIds: readonly (string | null | undefined)[];
  requiredRoleIds?: readonly (string | null | undefined)[];
  allowDeveloperOverride?: boolean;
}>;
