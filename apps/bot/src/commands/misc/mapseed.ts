import {
  InteractionContextType,
  ChannelType,
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  SlashCommandChannelOption,
  SlashCommandStringOption,
  SlashCommandUserOption,
} from 'discord.js';
import { randomInt } from 'node:crypto';

import { config } from '../../config.js';
import { seedPanel } from '../../ui/panels/misc.js';
import { respond } from '../../ui/reply.js';
import { ensureCommandAccess } from '../../utils/ensure-command-access.js';

const INT32_MIN = -(2 ** 31);
const INT32_MAX_EXCLUSIVE = 2 ** 31;

export const data = new SlashCommandBuilder()
  .setContexts(InteractionContextType.Guild)
  .setName('mapseed')
  .setDescription('Generate a random Civilization map seed.')
  .addStringOption((opt: SlashCommandStringOption) =>
    opt
      .setName('for')
      .setDescription('Optional game name (shown in the title).')
      .setMaxLength(120)
      .setRequired(false)
  )
  .addUserOption((opt: SlashCommandUserOption) =>
    opt
      .setName('tag')
      .setDescription('Optional user to mention in the output.')
      .setRequired(false)
  )
  .addChannelOption((opt: SlashCommandChannelOption) =>
    opt
      .setName('where')
      .setDescription('Optional channel or thread to mention in the output.')
      .addChannelTypes(
        ChannelType.GuildText,
        ChannelType.GuildAnnouncement,
        ChannelType.PublicThread,
        ChannelType.PrivateThread,
        ChannelType.AnnouncementThread
      )
      .setRequired(false)
  );

const ACCESS_POLICY = {
  allowedChannelIds: [
    config.discord.channels.botTesting,
    config.discord.channels.civ6Commands,
    config.discord.channels.civ7Commands,
    config.discord.channels.cloudCommands,
    config.discord.channels.civ6ffaVote,
    config.discord.channels.civ6teamerVote,
  ],
  requiredRoleIds: [
    config.discord.roles.civ6Rank,
    config.discord.roles.civ7Rank,
    config.discord.roles.civCloud,
  ],
  allowDeveloperOverride: true,
} as const;

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!(await ensureCommandAccess(interaction, ACCESS_POLICY))) return;
  const seed = String(randomInt(INT32_MIN, INT32_MAX_EXCLUSIVE));
  await respond(
    interaction,
    seedPanel(seed, {
      label: interaction.options.getString('for', false) ?? '',
      userId: interaction.options.getUser('tag', false)?.id ?? null,
      channelId: interaction.options.getChannel('where', false)?.id ?? null,
    }),
    'public',
  );
}
