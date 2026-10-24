import { InteractionContextType, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';

import { ApiError } from '../../api/errors.js';
import { ApiClient } from '../../api/index.js';
import type { StatsGameType } from '../../api/types.js';
import { config } from '../../config.js';
import { resetPanel } from '../../ui/panels/stats.js';
import { refuse, respond } from '../../ui/reply.js';
import { editionOf, editionOption } from '../../utils/edition.js';
import { ensureCommandAccess } from '../../utils/ensure-command-access.js';

const api = new ApiClient();

const ACCESS_POLICY = {
  allowedChannelIds: [
    config.discord.channels.botTesting,
  ],
  requiredRoleIds: [
    config.discord.roles.admin,
    config.discord.roles.noviceManager,
  ],
  allowDeveloperOverride: true,
  allowModeratorOverride: false,
} as const;

export const data = new SlashCommandBuilder()
  .setName('resetstats')
  .setDescription('Reset stats of a player.')
  .setContexts(InteractionContextType.Guild)
  .addStringOption(editionOption)
  .addStringOption((opt) =>
    opt
      .setName('mode')
      .setDescription('realtime or cloud')
      .setRequired(true)
      .addChoices({ name: 'realtime', value: 'realtime' }, { name: 'cloud', value: 'cloud' }),
  )
  .addUserOption((opt) => opt.setName('user').setDescription('Required: The user to reset stats of').setRequired(true));

export const visibility = 'public';

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!(await ensureCommandAccess(interaction, ACCESS_POLICY))) return;
  const civVersion = editionOf(interaction);
  const mode: StatsGameType = interaction.options.getString('mode', true) === 'cloud' ? 'cloud' : 'realtime';
  const target = interaction.options.getUser('user', true);
  const before = await api.resetUserStats(civVersion, mode, target.id).catch((error: unknown) => {
    if (error instanceof ApiError && error.status === 404) refuse(`<@${target.id}> has no ${civVersion} ${mode} stats to reset.`);
    throw error;
  });
  await respond(interaction, resetPanel(before), 'public');
}
