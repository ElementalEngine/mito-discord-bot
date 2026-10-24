import { InteractionContextType, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';

import { ApiClient } from '../../api/index.js';
import { pingPanel, type Reach } from '../../ui/panels/misc.js';
import { respond } from '../../ui/reply.js';
import { ensureCommandAccess } from '../../utils/ensure-command-access.js';
import { STATS_POLICY } from '../../utils/stats-options.js';

const api = new ApiClient();

export const data = new SlashCommandBuilder()
  .setContexts(InteractionContextType.Guild)
  .setName('ping')
  .setDescription('Check that the bot and the league server are answering.');

export const visibility = 'private';

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!(await ensureCommandAccess(interaction, STATS_POLICY))) return;
  const started = Date.now();
  const league: Reach = await api.ping().then(
    ({ dbMs }) => ({ ok: true, ms: Date.now() - started, dbMs }),
    () => ({ ok: false, ms: Date.now() - started, dbMs: null }),
  );
  await respond(interaction, pingPanel(interaction.client.ws.ping, league), 'private');
}
