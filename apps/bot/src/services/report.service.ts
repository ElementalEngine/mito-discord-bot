import type { Client } from 'discord.js';

import { ApiClient } from '../api/index.js';
import type { Match, SubQuota } from '../api/types.js';
import { config } from '../config.js';
import { isAssigned, seatsOf, type ReportView } from '../ui/panels/report.js';
import { log } from '../utils/log.js';
import { civNames, editionOf } from './civ-names.js';

// Everything a report panel shows beside the match: display names, and the
// quota of each player who came in as a sub. A quota that cannot be read is
// left off rather than holding the panel back.
export async function viewOf(match: Match, api = new ApiClient()): Promise<ReportView> {
  const subs = seatsOf(match)
    .filter((s) => s.leaver && isAssigned(s.player))
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
