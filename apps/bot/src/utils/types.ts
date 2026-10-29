export type CommandAccessPolicy = Readonly<{
  allowedChannelIds: readonly (string | null | undefined)[];
  requiredRoleIds?: readonly (string | null | undefined)[];
  allowDeveloperOverride?: boolean;
  // Moderators pass every check unless this is false.
  allowModeratorOverride?: boolean;
}>;
