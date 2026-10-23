import { GuildMember, InteractionContextType, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';

import { ApiClient } from '../../api/index.js';
import type { CivVersion, StatSet, UserStatsResponse } from '../../api/types.js';
import { config } from '../../config.js';
import { LIMITS } from '../../ui/kit/index.js';
import { formatRoomRanksPages, type RoomRanksLifetimeRow, type RoomRanksRow } from '../../ui/layouts/roomranks.js';
import { roomPanel } from '../../ui/panels/stats.js';
import { refuse, respond } from '../../ui/reply.js';
import { ensureCommandAccess } from '../../utils/ensure-command-access.js';

const api = new ApiClient();

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

// Room for the panel's heading and subtitle within Discord's text limit.
const PAGE_LIMIT = LIMITS.text - 300;

const nameOf = (m: GuildMember): string => (m.displayName || m.user.username || 'Unknown').replace(/\s+/g, ' ').trim();

const ratings = (set: StatSet | undefined) => ({
  ffa: set?.ffa?.mu ?? null,
  teamer: set?.teamer?.mu ?? null,
  duel: set?.duel?.mu ?? null,
});

export const data = new SlashCommandBuilder()
  .setName('roomranks')
  .setDescription('Show stats for everyone currently in your voice channel.')
  .setContexts(InteractionContextType.Guild)
  .addStringOption((opt) =>
    opt
      .setName('version')
      .setDescription('civ6 or civ7')
      .setRequired(true)
      .addChoices({ name: 'civ6', value: 'civ6' }, { name: 'civ7', value: 'civ7' }),
  );

export const visibility = 'public';

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!(await ensureCommandAccess(interaction, ACCESS_POLICY))) return;
  const civVersion: CivVersion = interaction.options.getString('version', true) === 'civ7' ? 'civ7' : 'civ6';
  if (!(interaction.member instanceof GuildMember)) refuse('Run /roomranks in the server, not in a DM.');
  const voice = interaction.member.voice.channel;
  if (!voice) refuse('Join a voice channel first, then run /roomranks.');
  const members = [...voice.members.values()].filter((m) => !m.user.bot);
  if (members.length === 0) refuse('Nobody but bots is in your voice channel.');

  const ids = members.map((m) => m.user.id);
  const [realtime, cloud] = await Promise.all([
    api.getUsersStatsBatch(civVersion, 'realtime', ids),
    api.getUsersStatsBatch(civVersion, 'cloud', ids),
  ]);
  const byId = (results: readonly UserStatsResponse[]) => new Map(results.map((r) => [r.discord_id, r]));
  const [realtimeById, cloudById] = [byId(realtime.results), byId(cloud.results)];

  // Highest lifetime FFA rating first; players with none last.
  const ranked = [...members].sort(
    (a, b) =>
      (realtimeById.get(b.user.id)?.lifetime.ffa?.mu ?? -1) - (realtimeById.get(a.user.id)?.lifetime.ffa?.mu ?? -1),
  );
  const realtimeRows: RoomRanksRow[] = ranked.map((m) => {
    const s = realtimeById.get(m.user.id);
    return { name: nameOf(m), lifetime: ratings(s?.lifetime), season: ratings(s?.season) };
  });
  const cloudRows: RoomRanksLifetimeRow[] = ranked.map((m) => ({
    name: nameOf(m),
    lifetime: ratings(cloudById.get(m.user.id)?.lifetime),
  }));
  const anyCloud = cloudRows.some((r) => Object.values(r.lifetime).some((mu) => mu !== null));

  const pages = formatRoomRanksPages({ realtimeRows, cloudLifetimeRows: anyCloud ? cloudRows : null }, PAGE_LIMIT);
  for (const [i, page] of pages.entries()) {
    await respond(interaction, roomPanel(page, voice.id, members.length, { n: i + 1, of: pages.length }), 'public');
  }
}
