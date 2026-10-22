import { InteractionContextType, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';

import { ApiClient } from '../../api/index.js';
import { config } from '../../config.js';
import { revertedPanel } from '../../ui/panels/report.js';
import { defer, fail, refuse, respond } from '../../ui/reply.js';
import { holdsAny, roleIdsOf } from '../../utils/access.js';
import { logAction } from '../../utils/log-command.js';

const api = new ApiClient();

export const data = new SlashCommandBuilder()
  .setContexts(InteractionContextType.Guild)
  .setName('revert-report')
  .setDescription('Undo an approved result and restore the ratings.')
  .addStringOption((option) =>
    option.setName('match-id').setDescription('ID of the match to revert').setRequired(true),
  );

// Reverting rolls ratings back, so it stays with admins and developers.
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  try {
    const roles = config.discord.roles;
    if (!holdsAny(roleIdsOf(interaction), [roles.admin, roles.developer])) {
      refuse('Only an admin or a developer can revert a report.');
    }
    await defer(interaction, 'public');
    const matchId = interaction.options.getString('match-id', true).trim();
    const match = await api.revert(matchId);
    await respond(interaction, revertedPanel(match), 'public');
    await logAction(interaction, 'revert-report', { matchId });
  } catch (error) {
    await fail(interaction, error, 'revert the report');
  }
}
