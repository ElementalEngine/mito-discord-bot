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
import { buildStatsEmbeds } from '../../ui/embeds/stats.js';
import { ensureCommandAccess } from '../../utils/ensure-command-access.js';
import { parseDiscordUserId } from '../../utils/parse-discord-id.js';

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

const CIV_VERSIONS = ['civ6', 'civ7'] satisfies readonly CivVersion[];
const GAME_TYPES = ['realtime', 'cloud'] satisfies readonly StatsGameType[];

async function replyError(interaction: ChatInputCommandInteraction, msg: string): Promise<void> {
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
    // swallow
  }
}

export const data = new SlashCommandBuilder()
  .setName('stats')
  .setDescription('View stats for yourself or another user.')
  .setDMPermission(false)
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
      .setName('game-type')
      .setDescription('realtime or cloud')
      .setRequired(true)
      .addChoices(
        { name: 'realtime', value: 'realtime' },
        { name: 'cloud', value: 'cloud' }
      )
  )
  .addStringOption((opt) =>
    opt
      .setName('mention')
      .setDescription('Optional: @user or user id')
      .setRequired(false)
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  try {
    if (!(await ensureCommandAccess(interaction, ACCESS_POLICY))) return;

    const civVersion = interaction.options.getString('version', true) as CivVersion;
    if (!CIV_VERSIONS.includes(civVersion)) {
      await replyError(interaction, `${EMOJI_ERROR} Invalid version.`);
      return;
    }

    const gameType = interaction.options.getString('game-type', true) as StatsGameType;
    if (!GAME_TYPES.includes(gameType)) {
      await replyError(interaction, `${EMOJI_ERROR} Invalid game-type.`);
      return;
    }

    const mentionRaw = interaction.options.getString('mention');
    let targetId = interaction.user.id;
    if (mentionRaw != null) {
      const parsed = parseDiscordUserId(mentionRaw);
      if (!parsed) {
        await replyError(interaction, `${EMOJI_ERROR} Invalid mention/user id.`);
        return;
      }
      targetId = parsed;
    }

    await interaction.deferReply();

    const svc = new StatsService();
    const resp = await svc.getUserStats({
      civVersion,
      gameType,
      discordId: targetId,
    });

    const embeds = buildStatsEmbeds({
      title: 'Stats',
      discordId: targetId,
      civVersion: resp.civ_version,
      gameType: resp.game_type,
      lifetime: resp.lifetime,
      season: resp.season,
    });

    await interaction.editReply({ embeds, allowedMentions: { parse: [] } });
  } catch (err: unknown) {
    if (err instanceof ApiError) {
      if (err.status === 404) {
        await replyError(interaction, `${EMOJI_ERROR} No stats found for that user.`);
        return;
      }

      // 400, 5xx, network
      await replyError(interaction, `${EMOJI_ERROR} Stats backend error (HTTP ${err.status}). Try again.`);
      return;
    }

    console.error('stats failed', {
      err,
      guildId: interaction.guildId ?? null,
      channelId: interaction.channelId,
      userId: interaction.user.id,
    });

    await replyError(interaction, `${EMOJI_ERROR} Stats failed due to an unexpected error.`);
  }
}
