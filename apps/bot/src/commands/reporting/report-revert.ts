import { InteractionContextType, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';

import { ApiClient } from '../../api/index.js';
import { refreshLeaderboards } from '../../jobs/update-leaderboard.js';
import { syncRankRoles } from '../../services/rank-role.service.js';
import { revertedPanel } from '../../ui/panels/report.js';
import { defer, fail, refuse, respond } from '../../ui/reply.js';
import { isAdminOrDeveloper } from '../../utils/access.js';
import { logAction } from '../../utils/log-command.js';

const api = new ApiClient();

export const data = new SlashCommandBuilder()
  .setContexts(InteractionContextType.Guild)
  .setName('report-revert')
  .setDescription('Undo an approved result and restore the ratings.')
  .addStringOption((option) =>
    option.setName('match-id').setDescription('ID of the match to revert').setRequired(true),
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  try {
    if (!isAdminOrDeveloper(interaction)) refuse('Only an admin or a developer can revert a report.');
    await defer(interaction, 'public');
    const matchId = interaction.options.getString('match-id', true).trim();
    const match = await api.revert(matchId);
    refreshLeaderboards(interaction.client, match.game);
    await respond(interaction, revertedPanel(match), 'public');
    if (interaction.guild) await syncRankRoles(interaction.guild, match.affected_players, matchId);
    await logAction(interaction, 'report-revert', { matchId });
  } catch (error) {
    await fail(interaction, error, 'revert the report');
  }
}
