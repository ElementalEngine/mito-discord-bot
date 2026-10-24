import type { Guild, GuildMember } from 'discord.js';

import { ApiClient } from '../api/index.js';
import type { CivVersion, StatSet, UserStatsResponse } from '../api/types.js';
import { LIMITS } from '../ui/kit/index.js';
import { formatRoomRanksPages, type RoomRanksLifetimeRow, type RoomRanksRow } from '../ui/layouts/roomranks.js';
import { refuse } from '../ui/reply.js';
import { MAX_PLAYERS } from '../utils/stats-options.js';

// Room for the panel's heading, subtitle and buttons within Discord's text limit.
const PAGE_LIMIT = LIMITS.text - 300;

const nameOf = (m: GuildMember): string => (m.displayName || m.user.username || 'Unknown').replace(/\s+/g, ' ').trim();

const ratings = (set: StatSet | undefined) => ({
  ffa: set?.ffa?.mu ?? null,
  teamer: set?.teamer?.mu ?? null,
  duel: set?.duel?.mu ?? null,
});

export type RoomRanks = Readonly<{ pages: string[]; players: number }>;

// The voice channel as it is now, so a page turned later shows who is there then.
export async function roomRanks(guild: Guild, voiceChannelId: string, civVersion: CivVersion, api = new ApiClient()): Promise<RoomRanks> {
  const voice = guild.channels.cache.get(voiceChannelId);
  if (!voice?.isVoiceBased()) refuse('That voice channel is gone. Run /roomranks again.');
  const members = [...voice.members.values()].filter((m) => !m.user.bot);
  if (members.length === 0) refuse('Nobody but bots is in that voice channel.');
  if (members.length > MAX_PLAYERS) refuse(`Room ranks show at most ${MAX_PLAYERS} players.`);

  const ids = members.map((m) => m.user.id);
  const [realtime, cloud] = await Promise.all([
    api.getUsersStatsBatch(civVersion, 'realtime', ids),
    api.getUsersStatsBatch(civVersion, 'cloud', ids),
  ]);
  const byId = (results: readonly UserStatsResponse[]) => new Map(results.map((r) => [r.discord_id, r]));
  const [realtimeById, cloudById] = [byId(realtime.results), byId(cloud.results)];

  // Highest lifetime FFA rating first; players with none last.
  const ranked = [...members].sort(
    (a, b) => (realtimeById.get(b.user.id)?.lifetime.ffa?.mu ?? -1) - (realtimeById.get(a.user.id)?.lifetime.ffa?.mu ?? -1),
  );
  const realtimeRows: RoomRanksRow[] = ranked.map((m) => {
    const s = realtimeById.get(m.user.id);
    return { name: nameOf(m), lifetime: ratings(s?.lifetime), season: ratings(s?.season) };
  });
  const cloudRows: RoomRanksLifetimeRow[] = ranked.map((m) => ({ name: nameOf(m), lifetime: ratings(cloudById.get(m.user.id)?.lifetime) }));
  const anyCloud = cloudRows.some((r) => Object.values(r.lifetime).some((mu) => mu !== null));
  const seasonLabel = realtime.results[0]?.season_label;
  const pages = formatRoomRanksPages({ realtimeRows, cloudLifetimeRows: anyCloud ? cloudRows : null, seasonLabel }, PAGE_LIMIT);
  return { pages, players: members.length };
}
