import type { ChatInputCommandInteraction } from 'discord.js';

import { COMMAND_ACCESS, wantedFor } from '../config/command-access.js';
import { say } from '../ui/reply.js';
import { holdsAny, roleIdsOf } from './access.js';

const mentions = (ids: readonly string[], prefix: string): string => ids.map((id) => `<${prefix}${id}>`).join(', ');

// The command's row in the table, narrowed by its subcommand's where it has
// one. A thread counts as its parent channel.
export async function ensureCommandAccess(interaction: ChatInputCommandInteraction): Promise<boolean> {
  if (!interaction.inGuild()) {
    await say(interaction, 'refused', 'This command must be used in a server.');
    return false;
  }
  const access = COMMAND_ACCESS[interaction.commandName];
  if (!access) {
    await say(interaction, 'failed', 'Command access is not configured.');
    return false;
  }
  const want = wantedFor(access, interaction.options.getSubcommand(false));
  if (want.channels) {
    const channel = interaction.channel;
    const here = channel?.isThread() ? (channel.parentId ?? interaction.channelId) : interaction.channelId;
    if (!want.channels.includes(here)) {
      await say(interaction, 'refused', want.channels.length ? `Use this command in: ${mentions(want.channels, '#')}` : 'Command access is not configured.');
      return false;
    }
  }
  if (!want.roles) return true;
  if (holdsAny(roleIdsOf(interaction), want.roles)) return true;
  await say(interaction, 'refused', want.roles.length ? `Missing required role. Need one of: ${mentions(want.roles, '@&')}` : 'Command access is not configured.');
  return false;
}
