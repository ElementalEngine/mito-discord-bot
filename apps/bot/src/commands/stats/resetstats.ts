import { InteractionContextType, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';

import { ApiError } from '../../api/errors.js';
import { ApiClient } from '../../api/index.js';
import type { ResetStatsResponse, StatSet } from '../../api/types.js';
import { MODES } from '../../config/constants.js';
import { refreshLeaderboards } from '../../jobs/update-leaderboard.js';
import { syncRankRoles } from '../../services/rank-role.service.js';
import { mentionWithId } from '../../ui/kit/index.js';
import { resetPanel } from '../../ui/panels/stats.js';
import { refuse, respond } from '../../ui/reply.js';
import { editionOf, editionOption } from '../../utils/edition.js';
import { ensureCommandAccess } from '../../utils/ensure-command-access.js';
import { logAction } from '../../utils/log-command.js';
import { modeOf, modeOption } from '../../utils/stats-options.js';

const api = new ApiClient();

export const data = new SlashCommandBuilder()
  .setName('resetstats')
  .setDescription('Reset stats of a player.')
  .setContexts(InteractionContextType.Guild)
  .addStringOption(editionOption)
  .addStringOption(modeOption)
  .addUserOption((opt) => opt.setName('user').setDescription('The player whose stats to reset').setRequired(true))
  .addStringOption((opt) => opt.setName('reason').setDescription('Why, for the report log').setMaxLength(500));

export const visibility = 'public';

// What the player had in each mode before the reset, for the report log.
const played = (set: StatSet): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const mode of MODES) {
    const row = set[mode];
    if (row && row.games > 0) out[mode] = { skill: row.mu, sigma: Math.round(row.sigma), games: row.games, wins: row.rating_gains, first: row.first };
  }
  return out;
};

const resetDetails = (before: ResetStatsResponse, reason: string | null): Record<string, unknown> => ({
  player: before.discord_id,
  edition: before.civ_version,
  mode: before.game_type,
  reason: reason ?? 'none given',
  before: { lifetime: played(before.lifetime), [before.season_label ?? 'season']: played(before.season) },
});

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!(await ensureCommandAccess(interaction))) return;
  const civVersion = editionOf(interaction);
  const mode = modeOf(interaction);
  const target = interaction.options.getUser('user', true);
  const reason = interaction.options.getString('reason')?.trim() || null;
  const before = await api.resetUserStats(civVersion, mode, target.id).catch((error: unknown) => {
    if (error instanceof ApiError && error.status === 404) refuse(`${mentionWithId(target.id)} has no ${civVersion} ${mode} stats to reset.`);
    throw error;
  });
  refreshLeaderboards(interaction.client, civVersion);
  await respond(interaction, resetPanel(before), 'public');
  await logAction(interaction, 'resetstats', resetDetails(before, reason));
  if (interaction.guild) await syncRankRoles(interaction.guild, before.affected_players, `reset ${target.id}`);
}
