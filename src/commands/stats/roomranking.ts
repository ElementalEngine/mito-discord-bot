import {
  ChatInputCommandInteraction,
  GuildMember,
  MessageFlags,
  SlashCommandBuilder,
} from 'discord.js';

import { ApiError } from '../../api/errors.js';
import type { CivVersion, StatsGameType } from '../../api/types.js';
import { config } from '../../config.js';
import { EMOJI_ERROR } from '../../config/constants.js';
import { StatsService } from '../../services/stats.service.js';
import { buildRoomRanksMessages } from '../../ui/roomranks.js';
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

const CIV_VERSIONS = ['civ6', 'civ7'] as const;
const GAME_TYPES = ['realtime', 'cloud'] as const;

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
  .setName('roomranks')
  .setDescription('Show stats for everyone currently in your voice channel.')
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
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  try {
    if (!(await ensureCommandAccess(interaction, ACCESS_POLICY))) return;

    const v = interaction.options.getString('version', true).toLowerCase();
    if (!CIV_VERSIONS.includes(v as CivVersion)) {
      await replyError(interaction, `${EMOJI_ERROR} Invalid version.`);
      return;
    }

    const gt = interaction.options.getString('game-type', true).toLowerCase();
    if (!GAME_TYPES.includes(gt as StatsGameType)) {
      await replyError(interaction, `${EMOJI_ERROR} Invalid game-type.`);
      return;
    }

    if (!interaction.inGuild()) {
      await replyError(interaction, `${EMOJI_ERROR} This command must be used in a server.`);
      return;
    }

    const member = interaction.member;
    if (!(member instanceof GuildMember)) {
      await replyError(interaction, `${EMOJI_ERROR} Unable to read your voice state. Try again.`);
      return;
    }

    const vc = member.voice.channel;
    if (!vc || !('members' in vc)) {
      await replyError(interaction, `${EMOJI_ERROR} Join a voice channel first.`);
      return;
    }

    const members = [...vc.members.values()].filter((m) => !m.user.bot);
    if (members.length === 0) {
      await replyError(interaction, `${EMOJI_ERROR} No non-bot users found in that voice channel.`);
      return;
    }

    await interaction.deferReply();

    const svc = new StatsService();
    const batch = await svc.getUsersStatsBatch({
      civVersion: v as CivVersion,
      gameType: gt as StatsGameType,
      discordIds: members.map((m) => m.user.id),
    });

    const map = new Map(batch.results.map((r) => [r.discord_id, r] as const));

    const rows = members
      .map((m) => {
        const r = map.get(m.user.id);
        return {
          name: m.displayName,
          lifetime: r?.lifetime ?? {},
          season: r?.season ?? {},
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    const messages = buildRoomRanksMessages(rows, {
      title: 'Room Ranks',
      includeSeason: (gt as StatsGameType) !== 'cloud',
    });

    // First page as the interaction reply; remainder as follow-ups.
    await interaction.editReply({ content: messages[0], allowedMentions: { parse: [] } });
    for (let i = 1; i < messages.length; i++) {
      await interaction.followUp({ content: messages[i], allowedMentions: { parse: [] } });
    }
  } catch (err: unknown) {
    if (err instanceof ApiError) {
      await replyError(interaction, `${EMOJI_ERROR} Stats backend error (HTTP ${err.status}). Try again.`);
      return;
    }

    console.error('roomranks failed', {
      err,
      guildId: interaction.guildId ?? null,
      channelId: interaction.channelId,
      userId: interaction.user.id,
    });

    await replyError(interaction, `${EMOJI_ERROR} Room ranks failed due to an unexpected error.`);
  }
}
