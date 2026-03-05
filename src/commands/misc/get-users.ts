import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  SlashCommandBuilder,
} from 'discord.js';

import { config } from '../../config.js';
import { EMOJI_REPORT } from '../../config/constants.js';
import { ensureCommandAccess } from '../../utils/ensure-command-access.js';

export const data = new SlashCommandBuilder()
  .setName('get-users')
  .setDescription('Get information about all users in the server.');

const ACCESS_POLICY = {
  allowedChannelIds: [
    config.discord.channels.botTesting,
  ],
  requiredRoleIds: [
    config.discord.roles.moderator,
    config.discord.roles.developer,
  ],
  allowDeveloperOverride: true,
} as const;

export async function execute(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const ok = await ensureCommandAccess(interaction, ACCESS_POLICY);
  if (!ok) return;

  await interaction.deferReply({ ephemeral: true });

  try {
    if (!interaction.guild) {
      await interaction.editReply('This command can only be used in a server.');
      return;
    }

    // Fetch all members from the guild
    const members = await interaction.guild.members.fetch();

    // Prepare user information in JSON format
    const usersData = members.map((member) => {
      const user = member.user;
      const roles = member.roles.cache
        .filter((role) => role.id !== interaction.guild?.id) // Exclude @everyone role
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

    // Convert to JSON string
    const jsonOutput = JSON.stringify(usersData, null, 2);

    // Discord has message limits, so we'll split if needed
    const MAX_FILE_SIZE = 8 * 1024 * 1024; // 8MB Discord limit
    
    if (jsonOutput.length > MAX_FILE_SIZE) {
      await interaction.editReply(
        `User data is too large (${(jsonOutput.length / 1024 / 1024).toFixed(2)}MB). ` +
        'Contact a developer to handle this data export.'
      );
      return;
    }

    // Create a buffer from the JSON string
    const buffer = Buffer.from(jsonOutput, 'utf-8');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `discord-users-${timestamp}.json`;

    // Send summary embed
    const embed = new EmbedBuilder()
      .setTitle(`${EMOJI_REPORT} Server Users Export`)
      .setDescription(
        `**Total Users:** ${members.size}\n` +
        `**Bots:** ${usersData.filter(u => u.is_bot).length}\n` +
        `**Regular Users:** ${usersData.filter(u => !u.is_bot).length}\n\n` +
        'User data exported as JSON file below.'
      )
      .setColor(0x5865f2)
      .setTimestamp();

    await interaction.editReply({ 
      embeds: [embed],
      files: [{
        attachment: buffer,
        name: filename,
      }],
    });
  } catch (error) {
    console.error('Error fetching users:', error);
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error occurred';
    await interaction.editReply(
      `Failed to fetch users: ${errorMessage}`
    );
  }
}
