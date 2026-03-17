import {
  ChannelType,
  ChatInputCommandInteraction,
  EmbedBuilder,
  SlashCommandBuilder,
  SlashCommandChannelOption,
  SlashCommandStringOption,
  SlashCommandUserOption,
} from 'discord.js';
import { randomInt } from 'node:crypto';

import { config } from '../../config.js';
import { EMOJI_REPORT } from '../../config/constants.js';
import { ensureCommandAccess } from '../../utils/ensure-command-access.js';

const INT32_MIN = -(2 ** 31);
const INT32_MAX_EXCLUSIVE = 2 ** 31;

function truncate(input: string, max: number): string {
  if (input.length <= max) return input;
  if (max <= 3) return input.slice(0, max);
  return `${input.slice(0, max - 3)}...`;
}

export const data = new SlashCommandBuilder()
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

export async function execute(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const ok = await ensureCommandAccess(interaction, ACCESS_POLICY);
  if (!ok) return;

  const forLabel = interaction.options.getString('for', false)?.trim() ?? '';
  const user = interaction.options.getUser('tag', false);
  const where = interaction.options.getChannel('where', false);

  const seed = String(randomInt(INT32_MIN, INT32_MAX_EXCLUSIVE));

  const titleSuffix = forLabel ? ` for ${forLabel}` : '';
  const title = truncate(`${EMOJI_REPORT} Random Map Seed${titleSuffix}`, 256);

  const lines = [seed];
  if (user) lines.push(`Tag: ${user.toString()}`);
  if (where) lines.push(`Where: ${where.toString()}`);

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(lines.join('\n'))
    .setColor(0xf85252);

  await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
}
