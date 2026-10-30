import { InteractionContextType, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';

import { ApiClient } from '../../api/index.js';
import { civNames } from '../../services/civ-names.js';
import { historyPanel } from '../../ui/panels/stats.js';
import { refuse, respond } from '../../ui/reply.js';
import { ensureCommandAccess } from '../../utils/ensure-command-access.js';
import { statsAskOf, withStatsOptions } from '../../utils/stats-options.js';

const api = new ApiClient();

export const data = withStatsOptions(
  new SlashCommandBuilder()
    .setName('stats-history')
    .setDescription('Your last games, or another user\'s, newest first.')
    .setContexts(InteractionContextType.Guild),
  'Optional: another user\'s games',
);

export const visibility = 'public';

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!(await ensureCommandAccess(interaction))) return;
  const { civVersion, mode, target } = statsAskOf(interaction);
  const [history, names] = await Promise.all([api.getStatsHistory(civVersion, mode, target, 0), civNames(civVersion, api)]);
  if (history.games.length === 0) refuse(`<@${target}> has no approved ${civVersion} ${mode} games yet.`);
  await respond(interaction, historyPanel(history, { civVersion, mode, target, asker: interaction.user.id }, names), 'public');
}
