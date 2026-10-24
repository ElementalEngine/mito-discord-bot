import { InteractionContextType, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';

import { ApiClient } from '../../api/index.js';
import { seasonPreviewPanel } from '../../ui/panels/season.js';
import { respond } from '../../ui/reply.js';
import { DEVELOPER_ONLY } from '../../utils/access.js';
import { editionOf, editionOption } from '../../utils/edition.js';
import { ensureCommandAccess } from '../../utils/ensure-command-access.js';

const api = new ApiClient();

export const data = new SlashCommandBuilder()
  .setName('season-new')
  .setDescription('End the current season and start the next one.')
  .setContexts(InteractionContextType.Guild)
  .addStringOption(editionOption);

export const visibility = 'private';

// Shows what would change; the panel's Start button makes the change.
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!(await ensureCommandAccess(interaction, DEVELOPER_ONLY))) return;
  const preview = await api.getSeason(editionOf(interaction));
  await respond(interaction, seasonPreviewPanel(preview), 'private');
}
