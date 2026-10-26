import type { Guild } from 'discord.js';

// Bring players into the cache, so forms and menus can name them without a
// fetch inside Discord's 3 second window.
export async function loadMembers(guild: Guild | null, ids: readonly string[]): Promise<void> {
  const missing = ids.filter((id) => !guild?.members.cache.has(id));
  if (guild && missing.length) await guild.members.fetch({ user: missing, time: 1_500 }).catch(() => undefined);
}

// Server names for forms and menus, where mentions do not render, from the
// cache only; anyone not in it is left out, for the caller to name.
export function memberNames(guild: Guild | null, ids: readonly string[]): ReadonlyMap<string, string> {
  if (!guild) return new Map();
  return new Map(
    ids.flatMap((id): [string, string][] => {
      const member = guild.members.cache.get(id);
      return member ? [[id, member.displayName]] : [];
    }),
  );
}
