import { SlashCommandBuilder } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';

import { ApiError } from '../../../core/api/errors.js';
import type { CivVersion, StatsGameType } from '../../../core/api/types.js';
import { config } from '../../../core/config/index.js';
import { EMOJI_ERROR } from '../../../core/config/constants.js';
import {
  ensureCommandAccess,
  replyEphemeral,
} from '../../../core/discord/index.js';
import { error as logError } from '../../../core/logging.js';
import { StatsService } from '../service.js';
import { buildStatsEmbed } from '../ui/stats.embed.js';

const ACCESS_POLICY = {
  allowedChannelIds: [
    config.discord.channels.botTesting,
  ],
  requiredRoleIds: [
    config.discord.roles.noviceManager,
    config.discord.roles.moderator
  ],
  allowDeveloperOverride: true,
} as const;

const statsService = new StatsService();


function isStatsMode(v: string): v is StatsGameType {
  return v === 'realtime' || v === 'cloud';
}

export const data = new SlashCommandBuilder()
  .setName('resetstats')
  .setDescription('Reset stats of a player.')
  .setDMPermission(false)
  .addStringOption((opt) =>
    opt
      .setName('game')
      .setDescription('civ6 or civ7')
      .setRequired(true)
      .addChoices(
        { name: 'civ6', value: 'civ6' },
        { name: 'civ7', value: 'civ7' }
      )
  )
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
      .setDescription('Required: The user to reset stats of')
      .setRequired(true)
  );

export async function execute(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  try {
    if (!(await ensureCommandAccess(interaction, ACCESS_POLICY))) return;

    const sub = interaction.options.getString('game', true);
    const civVersion: CivVersion = sub === 'civ7' ? 'civ7' : 'civ6';

    const modeRaw = interaction.options.getString('mode', true);
    if (!isStatsMode(modeRaw)) {
      await replyEphemeral(interaction, `${EMOJI_ERROR} Invalid mode.`);
      return;
    }
    const mode: StatsGameType = modeRaw;

    const targetUser = interaction.options.getUser('user', true);

    await interaction.deferReply();

    const resp = await statsService.resetUserStats({
      civVersion,
      gameType: mode,
      discordId: targetUser.id,
    });

    const embed = buildStatsEmbed({
      civVersion: resp.civ_version,
      mode: resp.game_type,
      targetMention: `${targetUser}`,
      lifetime: resp.lifetime,
      season: resp.season,
    });

    await interaction.editReply({
      content: `Stats reset for ${targetUser} in ${civVersion} (${modeRaw}) done. Previous stats:`,
      embeds: [embed],
      allowedMentions: { parse: [] },
    });
  } catch (err: unknown) {
    if (err instanceof ApiError) {
      if (err.status === 404) {
        await replyEphemeral(interaction, `${EMOJI_ERROR} No stats found for user.`);
        return;
      }

      await replyEphemeral(
        interaction,
        `${EMOJI_ERROR} Stats backend error (HTTP ${err.status}). Try again.`
      );
      return;
    }

    logError('resetstats failed', {
      err,
      guildId: interaction.guildId ?? null,
      channelId: interaction.channelId,
      userId: interaction.user.id,
    });

    await replyEphemeral(
      interaction,
      `${EMOJI_ERROR} Stats failed due to an unexpected error.`
    );
  }
}
