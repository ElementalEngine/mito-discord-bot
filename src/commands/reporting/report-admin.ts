import { SlashCommandBuilder } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';

import { config } from '../../config.js';
import { ensureCommandAccess } from '../../utils/ensure-command-access.js';

export const data = new SlashCommandBuilder()
  .setName('report-admin')
  .setDescription('Admin tools for match reports (staff only).')
  .addStringOption((option) =>
    option
      .setName('match-id')
      .setDescription('Match ID')
      .setRequired(true)
  );

const accessPolicy = Object.freeze({
  allowedChannelIds: [
    config.discord.channels.civ6realtimeUploads,
    config.discord.channels.civ7realtimeUploads,
    config.discord.channels.civ6cloudUploads,
    config.discord.channels.civ7cloudUploads,
    config.discord.channels.botTesting,
  ] as const,
  requiredRoleIds: [config.discord.roles.moderator] as const,
  allowDeveloperOverride: true,
});

export async function execute(interaction: ChatInputCommandInteraction) {
  const ok = await ensureCommandAccess(interaction, accessPolicy);
  if (!ok) return;

  const matchId = interaction.options.getString('match-id', true);
  await interaction.reply({
    content: `report-admin is not implemented yet (match-id: ${matchId}).`,
    ephemeral: true,
  });
}