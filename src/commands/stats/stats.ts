import {
  ChatInputCommandInteraction,
  MessageFlags,
  SlashCommandBuilder,
} from 'discord.js';

import { ApiError } from '../../api/errors.js';
import type { CivVersion, StatsGameType } from '../../api/types.js';
import { config } from '../../config.js';
import { EMOJI_ERROR } from '../../config/constants.js';
import { StatsService } from '../../services/stats.service.js';
import { buildStatsEmbed } from '../../ui/embeds/stats.js';
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

const statsService = new StatsService();

async function replyError(
  interaction: ChatInputCommandInteraction,
  msg: string
): Promise<void> {
  const base = { content: msg, allowedMentions: { parse: [] as const } } as const;

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
  }
}

function isStatsMode(v: string): v is StatsGameType {
  return v === 'realtime' || v === 'cloud';
}

export const data = new SlashCommandBuilder()
  .setName('stats')
  .setDescription('View stats for yourself or another user.')
  .setDMPermission(false)
  .addSubcommand((sc) =>
    sc
      .setName('civ6')
      .setDescription('View Civ6 stats')
      .addStringOption((opt) =>
        opt
          .setName('mode')
          .setDescription('realtime or cloud')
          .setRequired(true)
          .addChoices(
            { name: 'realtime', value: 'realtime' },
            { name: 'cloud', value: 'cloud' }
          )
      )
      .addUserOption((opt) =>
        opt
          .setName('user')
          .setDescription('Optional: look up another user')
          .setRequired(false)
      )
  )
  .addSubcommand((sc) =>
    sc
      .setName('civ7')
      .setDescription('View Civ7 stats')
      .addStringOption((opt) =>
        opt
          .setName('mode')
          .setDescription('realtime or cloud')
          .setRequired(true)
          .addChoices(
            { name: 'realtime', value: 'realtime' },
            { name: 'cloud', value: 'cloud' }
          )
      )
      .addUserOption((opt) =>
        opt
          .setName('user')
          .setDescription('Optional: look up another user')
          .setRequired(false)
      )
  );

export async function execute(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  try {
    if (!(await ensureCommandAccess(interaction, ACCESS_POLICY))) return;

    const sub = interaction.options.getSubcommand(true);
    const civVersion: CivVersion = sub === 'civ7' ? 'civ7' : 'civ6';

    const modeRaw = interaction.options.getString('mode', true);
    if (!isStatsMode(modeRaw)) {
      await replyError(interaction, `${EMOJI_ERROR} Invalid mode.`);
      return;
    }
    const mode: StatsGameType = modeRaw;

    const targetUser = interaction.options.getUser('user') ?? interaction.user;

    await interaction.deferReply();

    const resp = await statsService.getUserStats({
      civVersion,
      gameType: mode,
      discordId: targetUser.id,
    });

    const embed = buildStatsEmbed({
      civVersion: resp.civ_version,
      mode: resp.game_type,
      targetMention: `<@${targetUser.id}>`,
      lifetime: resp.lifetime,
      season: resp.season,
    });

    await interaction.editReply({
      embeds: [embed],
      allowedMentions: { parse: [] },
    });
  } catch (err: unknown) {
    if (err instanceof ApiError) {
      if (err.status === 404) {
        await replyError(interaction, `${EMOJI_ERROR} No stats found for that user.`);
        return;
      }

      await replyError(
        interaction,
        `${EMOJI_ERROR} Stats backend error (HTTP ${err.status}). Try again.`
      );
      return;
    }

    console.error('stats failed', {
      err,
      guildId: interaction.guildId ?? null,
      channelId: interaction.channelId,
      userId: interaction.user.id,
    });

    await replyError(
      interaction,
      `${EMOJI_ERROR} Stats failed due to an unexpected error.`
    );
  }
}
