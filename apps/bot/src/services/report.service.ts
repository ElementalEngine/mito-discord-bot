import type { Client, Guild } from 'discord.js';

import { ApiClient } from '../api/index.js';
import type { Match, SubQuota } from '../api/types.js';
import { config } from '../config.js';
import type { Panel } from '../ui/kit/index.js';
import { editorPanel } from '../ui/panels/report-edit.js';
import { isAssigned, playerIds, seatsOf, type ReportView } from '../ui/panels/report.js';
import { editPanelById } from '../ui/reply.js';
import { log } from '../utils/log.js';
import { civNames, editionOf } from './civ-names.js';

// Everything a report panel shows beside the match: display names and, while
// pending, each sub's quota. A quota that cannot be read is left off.
export async function viewOf(match: Match, api = new ApiClient()): Promise<ReportView> {
  const subs = seatsOf(match)
    .filter((s) => !match.approved_at && s.leaver && isAssigned(s.player))
    .map((s) => s.player.discord_id ?? '');
  const read = await Promise.all(
    subs.map((id) =>
      api.subQuota(id).catch((error: unknown) => {
        log.warn('sub quota unavailable', id, error instanceof Error ? error.message : error);
        return null;
      }),
    ),
  );
  const quotas = new Map(read.filter((q): q is SubQuota => q !== null).map((q): [string, SubQuota] => [q.discord_id, q]));
  return { match, names: await civNames(editionOf(match.game), api), quotas };
}

// Reports are uploaded, and their history kept, per edition and per mode.
export function uploadChannelId(match: Match): string {
  const c = config.discord.channels;
  const civ7 = editionOf(match.game) === 'civ7';
  if (match.is_cloud) return civ7 ? c.civ7cloudUploads : c.civ6cloudUploads;
  return civ7 ? c.civ7realtimeUploads : c.civ6realtimeUploads;
}

export function historyChannelId(match: Match): string {
  const c = config.discord.channels;
  const civ7 = editionOf(match.game) === 'civ7';
  if (match.is_cloud) return civ7 ? c.civ7cloudReportingHistory : c.civ6cloudReportingHistory;
  return civ7 ? c.civ7realtimeReportingHistory : c.civ6realtimeReportingHistory;
}

// The report's own messages in its uploads channel. Best effort: one that
// is already gone is not an error.
export async function deleteReportMessages(client: Client, match: Match): Promise<void> {
  const channel = await client.channels.fetch(uploadChannelId(match)).catch(() => null);
  if (!channel?.isTextBased()) return;
  for (const id of match.discord_messages_id_list) {
    await channel.messages.delete(id).catch(() => undefined);
  }
}

// Rewrite the public report after an edit. The edit has already landed, so
// a failure here is reported, not thrown: false means the report is stale.
export async function refreshReport(client: Client, match: Match, panel: Panel): Promise<boolean> {
  const id = match.discord_messages_id_list[0];
  const channel = await client.channels.fetch(uploadChannelId(match)).catch(() => null);
  if (!id || !channel?.isTextBased()) return false;
  return editPanelById(channel, id, panel).then(
    () => true,
    (error: unknown) => {
      log.warn('report not refreshed', match.match_id, error instanceof Error ? error.message : error);
      return false;
    },
  );
}

// Bring the members of a match into the cache, so the forms opened from the
// editor can name them without a fetch inside Discord's 3 second window.
async function loadMembers(guild: Guild | null, ids: readonly string[]): Promise<void> {
  const missing = ids.filter((id) => !guild?.members.cache.has(id));
  if (guild && missing.length) await guild.members.fetch({ user: missing, time: 1_500 }).catch(() => undefined);
}

// The private editor for a report, with its players' server names loaded so
// the forms it opens can name them at once.
export async function editorOf(guild: Guild | null, match: Match, staff: boolean, api: ApiClient): Promise<Panel> {
  const ids = playerIds(match);
  const [names] = await Promise.all([civNames(editionOf(match.game), api), loadMembers(guild, ids)]);
  return editorPanel(match, names, memberNames(guild, ids), staff);
}

// Server names for the edit forms, where mentions do not render, from the
// cache only; anyone not in it keeps the name in the save.
export function memberNames(guild: Guild | null, ids: readonly string[]): ReadonlyMap<string, string> {
  if (!guild) return new Map();
  return new Map(
    ids.flatMap((id): [string, string][] => {
      const member = guild.members.cache.get(id);
      return member ? [[id, member.displayName]] : [];
    }),
  );
}
