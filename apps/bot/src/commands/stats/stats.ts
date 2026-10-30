import { InteractionContextType, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';

import { ApiError } from '../../api/errors.js';
import { ApiClient } from '../../api/index.js';
import { civNames } from '../../services/civ-names.js';
import { statsPanel } from '../../ui/panels/stats.js';
import { refuse, respond } from '../../ui/reply.js';
import { ensureCommandAccess } from '../../utils/ensure-command-access.js';
import { statsAskOf, withStatsOptions } from '../../utils/stats-options.js';

const api = new ApiClient();

export const data = withStatsOptions(
  new SlashCommandBuilder()
    .setName('stats')
    .setDescription('View stats for yourself or another user.')
    .setContexts(InteractionContextType.Guild),
  'Optional: look up another user',
);

export const visibility = 'public';

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!(await ensureCommandAccess(interaction))) return;
  const { civVersion, mode, target } = statsAskOf(interaction);
  const [stats, summary, names] = await Promise.all([
    api.getUserStats(civVersion, mode, target).catch((error: unknown) => {
      if (error instanceof ApiError && error.status === 404) refuse(`<@${target}> has no ${civVersion} ${mode} stats yet.`);
      throw error;
    }),
    // The tables stand alone: a summary that cannot be read is left off.
    api.getStatsSummary(civVersion, mode, target).catch(() => undefined),
    civNames(civVersion, api),
  ]);
  await respond(interaction, statsPanel(stats, summary, names), 'public');
}
