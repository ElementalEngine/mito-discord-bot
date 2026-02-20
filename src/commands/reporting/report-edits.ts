import { SlashCommandBuilder } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';

import { config } from '../../config.js';
import { startReportEditsSession } from '../../services/report-edits.service.js';
import { ensureCommandAccess } from '../../utils/ensure-command-access.js';

export const data = new SlashCommandBuilder()
  .setName('report-edits')
  .setDescription('Edit a match report (uploader + staff).')
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
});

export async function execute(interaction: ChatInputCommandInteraction) {
  const ok = await ensureCommandAccess(interaction, accessPolicy);
  if (!ok) return;

  const matchId = interaction.options.getString('match-id', true);
  await startReportEditsSession(interaction, matchId);
}