import { GuildMember, InteractionContextType, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';

import { ApiClient } from '../../api/index.js';
import type { StatSet, UserStatsResponse } from '../../api/types.js';
import { LIMITS } from '../../ui/kit/index.js';
import { formatRoomRanksPages, type RoomRanksLifetimeRow, type RoomRanksRow } from '../../ui/layouts/roomranks.js';
import { roomPanel } from '../../ui/panels/stats.js';
import { refuse, respond } from '../../ui/reply.js';
import { editionOf, editionOption } from '../../utils/edition.js';
import { ensureCommandAccess } from '../../utils/ensure-command-access.js';
import { STATS_POLICY } from '../../utils/stats-options.js';

const api = new ApiClient();

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
  .addStringOption(editionOption);

export const visibility = 'public';

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!(await ensureCommandAccess(interaction, STATS_POLICY))) return;
  const civVersion = editionOf(interaction);
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

  const seasonLabel = realtime.results[0]?.season_label;
  const pages = formatRoomRanksPages({ realtimeRows, cloudLifetimeRows: anyCloud ? cloudRows : null, seasonLabel }, PAGE_LIMIT);
  for (const [i, page] of pages.entries()) {
    await respond(interaction, roomPanel(page, voice.id, members.length, { n: i + 1, of: pages.length }), 'public');
  }
}
