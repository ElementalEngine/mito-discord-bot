import { InteractionContextType, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';

import { ApiClient } from '../../api/index.js';
import { deleteReportMessages } from '../../services/report.service.js';
import { fail, say } from '../../ui/reply.js';
import { isStaff } from '../../utils/access.js';
import { logAction } from '../../utils/log-command.js';

const api = new ApiClient();

export const data = new SlashCommandBuilder()
  .setContexts(InteractionContextType.Guild)
  .setName('remove-match')
  .setDescription('Remove a report that is still waiting for approval.')
  .addStringOption((option) =>
    option.setName('match-id').setDescription('ID of the match to remove').setRequired(true),
  );

// The reporter or staff; core-api checks the reporter, staff is asserted.
export const visibility = 'private';

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const matchId = interaction.options.getString('match-id', true).trim();
  try {
    const match = await api.removeMatch(matchId, { id: interaction.user.id, isStaff: isStaff(interaction) });
    await deleteReportMessages(interaction.client, match);
    await say(interaction, 'success', `Match \`${matchId}\` is removed, with its report.`);
    await logAction(interaction, 'remove-match', { matchId });
  } catch (error) {
    await fail(interaction, error, 'remove the match');
  }
}
