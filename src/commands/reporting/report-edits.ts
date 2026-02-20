import {
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';

import { config } from '../../config.js';
import { EMOJI_FAIL } from '../../config/constants.js';
import { startReportEditsSession } from '../../services/report-edits.service.js';
import { ensureCommandAccess } from '../../utils/ensure-command-access.js';

const ACCESS_POLICY = {
  allowedChannelIds: [
    config.discord.channels.botTesting,
    config.discord.channels.civ6realtimeUploads,
    config.discord.channels.civ6cloudUploads,
    config.discord.channels.civ7realtimeUploads,
    config.discord.channels.civ7cloudUploads,
  ],
  allowDeveloperOverride: true,
} as const;

export const data = new SlashCommandBuilder()
  .setName('report-edits')
  .setDescription('Open the Report Edits UI for a match.')
  .setDMPermission(false)
  .addStringOption((option) =>
    option
      .setName('match-id')
      .setDescription('ID of the match to edit')
      .setRequired(true)
  );

async function replyEphemeral(
  interaction: ChatInputCommandInteraction,
  content: string
): Promise<void> {
  const base = { content, allowedMentions: { parse: [] as const } } as const;

  try {
    if (interaction.deferred) {
      await interaction.editReply(base);
      return;
    }

    const payload = { ...base, flags: MessageFlags.Ephemeral } as const;

    if (interaction.replied) {
      await interaction.followUp(payload);
      return;
    }

    await interaction.reply(payload);
  } catch {
    // swallow
  }
}

export async function execute(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  if (!(await ensureCommandAccess(interaction, ACCESS_POLICY))) return;

  const matchId = interaction.options.getString('match-id', true).trim();
  if (!matchId) {
    await replyEphemeral(interaction, `${EMOJI_FAIL} Missing match id.`);
    return;
  }
  await startReportEditsSession(interaction, matchId);
}
