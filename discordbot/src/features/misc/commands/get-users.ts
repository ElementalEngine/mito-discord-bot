import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';

import { config } from '../../../core/config/index.js';
import { EMOJI_REPORT } from '../../../core/config/constants.js';
import { ensureCommandAccess } from '../../../core/discord/index.js'; 
import { error as logError } from '../../../core/logging.js';

export const data = new SlashCommandBuilder()
  .setName('get-users')
  .setDescription('Get information about all users in the server.');

const ACCESS_POLICY = {
  allowedChannelIds: [config.discord.channels.botTesting],
  requiredRoleIds: [
    config.discord.roles.moderator,
    config.discord.roles.developer,
  ],
  allowDeveloperOverride: true,
} as const;

const MAX_FILE_SIZE = 8 * 1024 * 1024; // 8MB Discord limit

export async function execute(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const ok = await ensureCommandAccess(interaction, ACCESS_POLICY);
  if (!ok) return;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    if (!interaction.guild) {
      await interaction.editReply('This command can only be used in a server.');
      return;
    }

    const members = await interaction.guild.members.fetch();

    const usersData = members.map((member) => {
      const user = member.user;
      const roles = member.roles.cache
        .filter((role) => role.id !== interaction.guild?.id) // Exclude @everyone
        .map((role) => ({
          id: role.id,
          name: role.name,
        }));

      return {
        username: user.username,
        user_id: user.id,
        nickname: member.nickname ?? null,
        display_name: member.displayName,
        join_date: member.joinedAt?.toISOString() ?? null,
        is_bot: user.bot,
        roles: roles,
      };
    });

    const jsonOutput = JSON.stringify(usersData, null, 2);

    if (jsonOutput.length > MAX_FILE_SIZE) {
      await interaction.editReply(
        `User data is too large (${(jsonOutput.length / 1024 / 1024).toFixed(2)}MB). ` +
          'Contact a developer to handle this data export.'
      );
      return;
    }

    const buffer = Buffer.from(jsonOutput, 'utf-8');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `discord-users-${timestamp}.json`;

    const embed = new EmbedBuilder()
      .setTitle(`${EMOJI_REPORT} Server Users Export`)
      .setDescription(
        `**Total Users:** ${members.size}\n` +
          `**Bots:** ${usersData.filter((u) => u.is_bot).length}\n` +
          `**Regular Users:** ${usersData.filter((u) => !u.is_bot).length}\n\n` +
          'User data exported as JSON file below.'
      )
      .setColor(0x5865f2)
      .setTimestamp();

    await interaction.editReply({
      embeds: [embed],
      files: [
        {
          attachment: buffer,
          name: filename,
        },
      ],
    });
  } catch (error) {
    logError('Error fetching users:', error);
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error occurred';
    await interaction.editReply(`Failed to fetch users: ${errorMessage}`);
  }
}
