import { InteractionContextType, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';

import { ApiError } from '../../api/errors.js';
import { ApiClient } from '../../api/index.js';
import type { CivVersion, StatsGameType } from '../../api/types.js';
import { config } from '../../config.js';
import { statsPanel } from '../../ui/panels/stats.js';
import { refuse, respond } from '../../ui/reply.js';
import { ensureCommandAccess } from '../../utils/ensure-command-access.js';

const api = new ApiClient();

const ACCESS_POLICY = {
  allowedChannelIds: [
    config.discord.channels.botTesting,
    config.discord.channels.civ6Commands,
    config.discord.channels.civ7Commands,
    config.discord.channels.cloudCommands,
    config.discord.channels.noviceCommands,
  ],
  requiredRoleIds: [
    config.discord.roles.civ6Rank,
    config.discord.roles.civ7Rank,
    config.discord.roles.civCloud,
  ],
  allowDeveloperOverride: true,
} as const;

const MODES = [
  { name: 'realtime', value: 'realtime' },
  { name: 'cloud', value: 'cloud' },
] as const;

export const data = new SlashCommandBuilder()
  .setName('stats')
  .setDescription('View stats for yourself or another user.')
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((sc) =>
    sc
      .setName('civ6')
      .setDescription('View Civ6 stats')
      .addStringOption((opt) => opt.setName('mode').setDescription('realtime or cloud').setRequired(true).addChoices(...MODES))
      .addUserOption((opt) => opt.setName('user').setDescription('Optional: look up another user').setRequired(false)),
  )
  .addSubcommand((sc) =>
    sc
      .setName('civ7')
      .setDescription('View Civ7 stats')
      .addStringOption((opt) => opt.setName('mode').setDescription('realtime or cloud').setRequired(true).addChoices(...MODES))
      .addUserOption((opt) => opt.setName('user').setDescription('Optional: look up another user').setRequired(false)),
  );

export const visibility = 'public';

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!(await ensureCommandAccess(interaction, ACCESS_POLICY))) return;
  const civVersion: CivVersion = interaction.options.getSubcommand(true) === 'civ7' ? 'civ7' : 'civ6';
  const mode: StatsGameType = interaction.options.getString('mode', true) === 'cloud' ? 'cloud' : 'realtime';
  const target = interaction.options.getUser('user') ?? interaction.user;
  const stats = await api.getUserStats(civVersion, mode, target.id).catch((error: unknown) => {
    if (error instanceof ApiError && error.status === 404) refuse(`<@${target.id}> has no ${civVersion} ${mode} stats yet.`);
    throw error;
  });
  await respond(interaction, statsPanel(stats), 'public');
}
