import {
  ChatInputCommandInteraction,
  GuildMember,
  MessageFlags,
  SlashCommandBuilder,
} from 'discord.js';

import { config } from '../../config.js';
import { EMOJI_ROOM_RANKINGS } from '../../config/constants.js';
import { ApiError } from '../../api/errors.js';
import { TeamGenService } from '../../services/teamgen.service.js';
import { ensureCommandAccess } from '../../utils/ensure-command-access.js';

const ACCESS_POLICY = {
  allowedChannelIds: [
    config.discord.channels.botTesting,
    config.discord.channels.civ6Commands,
    config.discord.channels.civ7Commands,
    config.discord.channels.cloudCommands,
  ],
  requiredRoleIds: [
    config.discord.roles.civ6Rank,
    config.discord.roles.civ7Rank,
    config.discord.roles.civCloud,
  ],
  allowDeveloperOverride: true,
} as const;

const VERSIONS = ['civ6', 'civ7'] as const;
type CivVersion = (typeof VERSIONS)[number];

const teamgenService = new TeamGenService();

async function replyError(
  interaction: ChatInputCommandInteraction,
  content: string
): Promise<void> {
  const base = { content, allowedMentions: { parse: [] as const } } as const;

  try {
    if (interaction.deferred) {
      await interaction.editReply(base);
      return;
    }

    const payload = { ...base, flags: MessageFlags.Ephemeral } as const;
    if (interaction.replied) {
      await interaction.followUp(payload);
      return;
    }
    await interaction.reply(payload);
  } catch {
    // ignore
  }
}

export const data = new SlashCommandBuilder()
  .setName('teamgen')
  .setDescription('Create two balanced teams to compete.')
  .addStringOption((opt) =>
    opt
      .setName('version')
      .setDescription('civ6 or civ7')
      .setRequired(true)
      .addChoices(
        { name: 'civ6', value: 'civ6' },
        { name: 'civ7', value: 'civ7' }
      )
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!(await ensureCommandAccess(interaction, ACCESS_POLICY))) return;

  if (!interaction.inGuild()) {
    await replyError(interaction, 'This command must be used in a server.');
    return;
  }

  const versionRaw = interaction.options.getString('version', true);
  if (!VERSIONS.includes(versionRaw as CivVersion)) {
    await replyError(interaction, 'Invalid version.');
    return;
  }

  if (!(interaction.member instanceof GuildMember)) {
    await replyError(interaction, 'Member context is missing for this interaction.');
    return;
  }

  const voiceChannel = interaction.member.voice.channel;
  if (!voiceChannel || !('members' in voiceChannel)) {
    await replyError(interaction, 'Join a voice channel first, then run /teamgen.');
    return;
  }

  const members = [...voiceChannel.members.values()].filter((m) => !m.user.bot);
  if (members.length === 0) {
    await replyError(interaction, 'No non-bot users found in your voice channel.');
    return;
  }

  const channelId = interaction.channelId;
  const isCloudChannel = channelId === config.discord.channels.cloudCommands;
  const gameType = isCloudChannel ? 'cloud' : 'realtime';

  await interaction.deferReply();

  try {
    const discordIds = members.map((m) => m.user.id);
    const teamGenResult = await teamgenService.getTeamGen({
        civVersion: versionRaw as CivVersion,
        gameType: gameType,
        discordIds,
    });
    interaction.editReply({
      content: `${EMOJI_ROOM_RANKINGS} **Team Generator Result** (Match Quality: ${teamGenResult.game_quality.toFixed(2)})\n\n` +
        teamGenResult.teams.map((team, i) => `**Team ${i + 1}:**\n${team.map(id => `<@${id}>`).join('\n')}`).join('\n\n`'),
    });
  } catch (err: unknown) {
    if (err instanceof ApiError) {
      const detail =
        typeof err.body === 'string'
          ? err.body
          : err.body
            ? JSON.stringify(err.body)
            : '';
      await interaction.editReply({
        content: `Backend error (${err.status}). ${detail}`.trim(),
        allowedMentions: { parse: [] },
      });
      return;
    }

    const msg = err instanceof Error ? err.message : 'Unknown error';
    await interaction.editReply({
      content: `Failed to generate teams: ${msg}`,
      allowedMentions: { parse: [] },
    });
  }
}
