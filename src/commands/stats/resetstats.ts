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
  ],
  requiredRoleIds: [
    config.discord.roles.noviceManager,
    config.discord.roles.moderator
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
      await replyError(interaction, `${EMOJI_ERROR} Invalid mode.`);
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

    await 
    await interaction.editReply({
      content: `Stats reset for ${targetUser} in ${civVersion} (${modeRaw}) done. Previous stats:`,
      embeds: [embed],
      allowedMentions: { parse: [] },
    });
  } catch (err: unknown) {
    if (err instanceof ApiError) {
      if (err.status === 404) {
        await replyError(interaction, `${EMOJI_ERROR} No stats found for user.`);
        return;
      }

      await replyError(
        interaction,
        `${EMOJI_ERROR} Stats backend error (HTTP ${err.status}). Try again.`
      );
      return;
    }

    console.error('resetstats failed', {
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
