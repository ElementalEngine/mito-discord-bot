import type { Interaction } from 'discord.js';

import { config } from '../config.js';

// Discord's Integrations settings decide who may run a command, and where.
// Buttons carry no permissions, so staff is checked here.

export function roleIdsOf(interaction: Interaction): ReadonlySet<string> {
  if (interaction.inCachedGuild()) return new Set(interaction.member.roles.cache.keys());
  const roles = (interaction.member as { roles?: unknown } | null)?.roles;
  return new Set(Array.isArray(roles) ? roles.filter((r): r is string => typeof r === 'string') : []);
}

export function holdsAny(held: ReadonlySet<string>, wanted: readonly string[]): boolean {
  return wanted.some((id) => id.trim() !== '' && held.has(id.trim()));
}

// Approving and reverting move ratings, so they stay with admins and developers.
export function isAdminOrDeveloper(interaction: Interaction): boolean {
  const { admin, developer } = config.discord.roles;
  return holdsAny(roleIdsOf(interaction), [admin, developer]);
}

// Staff is a moderator or a developer, as the Activity has it.
export const staffRoleIds = (): string[] => [config.discord.roles.moderator, config.discord.roles.developer];

export function isStaff(interaction: Interaction): boolean {
  return holdsAny(roleIdsOf(interaction), staffRoleIds());
}
