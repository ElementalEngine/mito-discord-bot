import type { ApplicationCommandPermissions, Client, Guild } from 'discord.js';

import { COMMAND_ACCESS, driftOf, wantedFor, type Drift } from '../config/command-access.js';
import { config } from '../config.js';
import { log } from '../utils/log.js';

const nameOf = (guild: Guild, kind: Drift['kind'], token: string): string => {
  const id = token.replace(/^!/, '');
  const name =
    kind === 'channels'
      ? `#${guild.channels.cache.get(id)?.name ?? id}`
      : kind === 'roles'
        ? `@${guild.roles.cache.get(id)?.name ?? id}`
        : id;
  return token.startsWith('!') ? `not ${name}` : name;
};

const listOf = (guild: Guild, kind: Drift['kind'], ids: string[] | null): string =>
  ids === null ? 'anyone' : ids.length ? ids.map((id) => nameOf(guild, kind, id)).join(', ') : 'nobody';

// Compares the table with the guild's Integrations overrides and says what
// differs. A bot can read overrides but not write them, so an admin sets them.
export async function checkCommandAccess(client: Client): Promise<void> {
  const guild = await client.guilds.fetch(config.discord.guildId);
  const [commands, overrides] = await Promise.all([guild.commands.fetch(), guild.commands.permissions.fetch({})]);
  const appWide: readonly ApplicationCommandPermissions[] = overrides.get(config.discord.clientId) ?? [];
  const lines: string[] = [];
  for (const command of commands.values()) {
    const access = COMMAND_ACCESS[command.name];
    if (!access) {
      lines.push(`/${command.name}: not in the access table`);
      continue;
    }
    const drift = driftOf(wantedFor(access), overrides.get(command.id) ?? appWide, guild.id);
    for (const d of drift) {
      lines.push(`/${command.name} ${d.kind}: want ${listOf(guild, d.kind, d.want)}; Discord allows ${listOf(guild, d.kind, d.have)}`);
    }
  }
  if (lines.length === 0) log.info(`Command access matches Discord for all ${commands.size} commands`);
  else log.warn(`Command access differs from Discord in ${lines.length} places:\n  ${lines.join('\n  ')}`);
}
