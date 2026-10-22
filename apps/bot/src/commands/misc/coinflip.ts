import { InteractionContextType, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { randomInt } from 'node:crypto';

import { config } from '../../config.js';
import { coinPanel } from '../../ui/panels/misc.js';
import { respond } from '../../ui/reply.js';
import { ensureCommandAccess } from '../../utils/ensure-command-access.js';

export const data = new SlashCommandBuilder()
  .setContexts(InteractionContextType.Guild)
  .setName('coinflip')
  .setDescription('Flip a coin.');

const ACCESS_POLICY = {
  allowedChannelIds: [
    config.discord.channels.botTesting,
    config.discord.channels.civ6Commands,
    config.discord.channels.civ7Commands,
    config.discord.channels.cloudCommands,
    config.discord.channels.noviceCommands,
  ],
  requiredRoleIds: [config.discord.roles.civ6Rank, config.discord.roles.civ7Rank, config.discord.roles.civCloud],
  allowDeveloperOverride: true,
} as const;

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!(await ensureCommandAccess(interaction, ACCESS_POLICY))) return;
  await respond(interaction, coinPanel(randomInt(0, 2) === 0 ? 'heads' : 'tails'), 'public');
}
