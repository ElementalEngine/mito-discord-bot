import { GuildMember, SlashCommandBuilder } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';

import { ApiError } from '../../../core/api/errors.js';
import { config } from '../../../core/config/index.js';
import { EMOJI_ROOM_RANKINGS } from '../../../core/config/constants.js';
import {
  ensureCommandAccess,
  replyEphemeral,
} from '../../../core/discord/index.js';
import { normalizePlayerList } from '../../../shared/player-list.js';
import { TeamGenService } from '../service.js';

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

const VERSIONS = ['civ6', 'civ7'] as const;
type CivVersion = (typeof VERSIONS)[number];

const teamgenService = new TeamGenService();

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
  )
  .addStringOption((opt) =>
    opt
      .setName('discord-ids')
      .setDescription(
        'list of player discord ids (only needed if running in cloud-commands channel)'
      )
      .setRequired(false)
  );

export async function execute(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  if (!(await ensureCommandAccess(interaction, ACCESS_POLICY))) return;

  if (!interaction.inGuild()) {
    await replyEphemeral(interaction, 'This command must be used in a server.');
    return;
  }

  const versionRaw = interaction.options.getString('version', true);
  if (!VERSIONS.includes(versionRaw as CivVersion)) {
    await replyEphemeral(interaction, 'Invalid version.');
    return;
  }

  if (!(interaction.member instanceof GuildMember)) {
    await replyEphemeral(
      interaction,
      'Member context is missing for this interaction.'
    );
    return;
  }

  const channelId = interaction.channelId;
  const isCloudChannel = channelId === config.discord.channels.cloudCommands;
  const gameType = isCloudChannel ? 'cloud' : 'realtime';

  // F12(2): legacy declared this with `var`.
  let discordIds: string[];

  if (!isCloudChannel) {
    const voiceChannel = interaction.member.voice.channel;
    if (!voiceChannel || !('members' in voiceChannel)) {
      await replyEphemeral(
        interaction,
        'Join a voice channel first, then run /teamgen.'
      );
      return;
    }

    const members = [...voiceChannel.members.values()].filter(
      (m) => !m.user.bot
    );
    if (members.length === 0) {
      await replyEphemeral(
        interaction,
        'No non-bot users found in your voice channel.'
      );
      return;
    }

    discordIds = members.map((m) => m.user.id);
  } else {
    const rawIds = interaction.options.getString('discord-ids', true);
    discordIds = normalizePlayerList(rawIds).split(/\s+/).filter(Boolean);
    if (discordIds.length === 0) {
      await replyEphemeral(
        interaction,
        'Please provide at least one Discord ID.'
      );
      return;
    }
  }

  await interaction.deferReply();

  try {
    const teamGenResult = await teamgenService.getTeamGen({
      civVersion: versionRaw as CivVersion,
      gameType,
      discordIds,
    });


    await interaction.editReply({
      content:
        `${EMOJI_ROOM_RANKINGS} **Team Generator Result** (Match Quality: ${teamGenResult.game_quality.toFixed(2)})\n\n` +
        teamGenResult.teams
          .map(
            (team, i) =>
              `**Team ${i + 1}:**\n${team.map((id) => `<@${id}>`).join('\n')}`
          )
          .join('\n\n`'),
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
