import {
  ChatInputCommandInteraction,
  GuildMember,
  MessageFlags,
  SlashCommandBuilder,
} from 'discord.js';

import { config } from '../../config.js';
import { EMOJI_ROOM_RANKINGS } from '../../config/constants.js';
import { ApiError } from '../../api/errors.js';
import { StatsService } from '../../services/stats.service.js';
import {
  formatRoomRanksPages,
  type RoomRanksLifetimeRow,
  type RoomRanksRow,
} from '../../ui/layouts/roomranks.js';
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

type ModeKey = 'ffa' | 'teamer' | 'duel';
type StatModeLike = { mu?: unknown };

const statsService = new StatsService();

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

function safeDisplayName(m: GuildMember): string {
  const name = m.displayName || m.user.username || 'Unknown';
  return name.replace(/\s+/g, ' ').trim();
}

function extractMu(mode: unknown): number | null {
  if (!mode || typeof mode !== 'object') return null;
  const mu = (mode as StatModeLike).mu;
  return typeof mu === 'number' && Number.isFinite(mu) ? mu : null;
}

function readMode(set: unknown, key: ModeKey): unknown {
  if (!set || typeof set !== 'object') return undefined;
  const obj = set as Record<string, unknown>;
  return obj[key];
}

function muOf(set: unknown, key: ModeKey): number | null {
  return extractMu(readMode(set, key));
}

type UserStatsLike = Readonly<{
  discord_id: string;
  lifetime?: unknown;
  season?: unknown;
}>;

type BatchLike = Readonly<{
  results: readonly UserStatsLike[];
}>;

function isBatchLike(v: unknown): v is BatchLike {
  if (!v || typeof v !== 'object') return false;
  const res = (v as { results?: unknown }).results;
  return Array.isArray(res);
}

function toRealtimeRow(member: GuildMember, stats?: UserStatsLike): RoomRanksRow {
  return {
    name: safeDisplayName(member),
    lifetime: {
      ffa: stats ? muOf(stats.lifetime, 'ffa') : null,
      teamer: stats ? muOf(stats.lifetime, 'teamer') : null,
      duel: stats ? muOf(stats.lifetime, 'duel') : null,
    },
    season: {
      ffa: stats ? muOf(stats.season, 'ffa') : null,
      teamer: stats ? muOf(stats.season, 'teamer') : null,
      duel: stats ? muOf(stats.season, 'duel') : null,
    },
  };
}

function toCloudLifetimeRow(
  member: GuildMember,
  stats?: UserStatsLike
): RoomRanksLifetimeRow {
  return {
    name: safeDisplayName(member),
    lifetime: {
      ffa: stats ? muOf(stats.lifetime, 'ffa') : null,
      teamer: stats ? muOf(stats.lifetime, 'teamer') : null,
      duel: stats ? muOf(stats.lifetime, 'duel') : null,
    },
  };
}

function hasAnyLifetimeStats(row: RoomRanksLifetimeRow): boolean {
  const { ffa, teamer, duel } = row.lifetime;
  return (
    (typeof ffa === 'number' && Number.isFinite(ffa)) ||
    (typeof teamer === 'number' && Number.isFinite(teamer)) ||
    (typeof duel === 'number' && Number.isFinite(duel))
  );
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
    await replyError(interaction, 'Join a voice channel first, then run /roomranks.');
    return;
  }

  const members = [...voiceChannel.members.values()].filter((m) => !m.user.bot);
  if (members.length === 0) {
    await replyError(interaction, 'No non-bot users found in your voice channel.');
    return;
  }

  await interaction.deferReply();

  try {
    const discordIds = members.map((m) => m.user.id);

    const [realtimeRaw, cloudRaw] = await Promise.all([
      statsService.getUsersStatsBatch({
        civVersion: versionRaw as CivVersion,
        gameType: 'realtime',
        discordIds,
      }),
      statsService.getUsersStatsBatch({
        civVersion: versionRaw as CivVersion,
        gameType: 'cloud',
        discordIds,
      }),
    ]);

    if (!isBatchLike(realtimeRaw) || !isBatchLike(cloudRaw)) {
      await interaction.editReply({
        content: 'Backend returned an unexpected response shape for room rankings.',
        allowedMentions: { parse: [] },
      });
      return;
    }

    const realtimeById = new Map(realtimeRaw.results.map((r) => [r.discord_id, r] as const));
    const cloudById = new Map(cloudRaw.results.map((r) => [r.discord_id, r] as const));

    const ranked = members
      .map((m) => ({
        member: m,
        realtime: realtimeById.get(m.user.id),
        cloud: cloudById.get(m.user.id),
      }))
      .sort(
        (a, b) =>
          (muOf(b.realtime?.lifetime, 'ffa') ?? -1) -
          (muOf(a.realtime?.lifetime, 'ffa') ?? -1)
      );

    const realtimeRows = ranked.map((r) => toRealtimeRow(r.member, r.realtime));
    const cloudLifetimeRows = ranked.map((r) => toCloudLifetimeRow(r.member, r.cloud));
    const showCloud = cloudLifetimeRows.some(hasAnyLifetimeStats);
    const subtitle = `Voice: <#${voiceChannel.id}> • Users: ${members.length}`;
    const pages = formatRoomRanksPages({
      titleEmoji: EMOJI_ROOM_RANKINGS, 
      subtitle,
      realtimeRows,
      cloudLifetimeRows: showCloud ? cloudLifetimeRows : null,
    });

    await interaction.editReply({ content: pages[0]!, allowedMentions: { parse: [] } });
    for (let i = 1; i < pages.length; i += 1) {
      await interaction.followUp({ content: pages[i]!, allowedMentions: { parse: [] } });
    }
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
      content: `Failed to fetch room rankings: ${msg}`,
      allowedMentions: { parse: [] },
    });
  }
}
