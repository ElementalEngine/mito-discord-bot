import { InteractionContextType, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';

import { openEditor } from '../../handlers/report.handlers.js';
import { fail } from '../../ui/reply.js';

export const data = new SlashCommandBuilder()
  .setContexts(InteractionContextType.Guild)
  .setName('report-edit')
  .setDescription('Edit a report that is still waiting for approval: its reporter, or staff.')
  .addStringOption((option) => option.setName('match-id').setDescription('ID of the match to edit').setRequired(true));

// The reporter or staff, privately; core-api checks the reporter on each save.
export const visibility = 'private';

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  try {
    await openEditor(interaction, interaction.options.getString('match-id', true).trim());
  } catch (error) {
    await fail(interaction, error, 'open the editor');
  }
}
