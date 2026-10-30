import type { Client } from 'discord.js';

import type { ApiClient } from '../api/index.js';
import type { Match } from '../api/types.js';
import { refreshLeaderboards } from '../jobs/update-leaderboard.js';
import { playerIds, reportPanel, revertedPanel } from '../ui/panels/report.js';
import { editPanelById, postPanel } from '../ui/reply.js';
import { log } from '../utils/log.js';
import { deleteReportMessages, historyChannelId, refreshReport, viewOf } from './report.service.js';
import { sendableIn } from './setup.js';

const reason = (error: unknown): unknown => (error instanceof Error ? error.message : error);

// Results this process has posted. core-api answers a repeated approve with
// the approved match, so a press after a lost answer can still post it, once.
const posted = new Set<string>();

export type Published = 'posted' | 'kept' | 'already';

// An approved result shown on its report and posted to history, the post
// recorded for a revert; the report is cleared only once history has it.
export async function publishApproved(client: Client, match: Match, api: ApiClient): Promise<Published> {
  refreshLeaderboards(client, match.game);
  if (posted.has(match.match_id)) return 'already';
  const panel = reportPanel(await viewOf(match, api));
  const history = await sendableIn(client, historyChannelId(match));
  const [sent] = await Promise.all([
    history
      ? postPanel(history, panel, { users: playerIds(match) }).catch((error: unknown) => {
          log.warn('approved result not posted', match.match_id, reason(error));
          return null;
        })
      : null,
    refreshReport(client, match, panel),
  ]);
  if (!sent) return 'kept';
  posted.add(match.match_id);
  await api.recordHistoryPost(match.match_id, sent.id).catch((error: unknown) => log.warn('history post not recorded', match.match_id, reason(error)));
  await deleteReportMessages(client, match);
  return 'posted';
}

// A reverted result's history post says so, where its post was recorded.
export async function showReverted(client: Client, match: Match): Promise<void> {
  const history = match.history_message_id ? await sendableIn(client, historyChannelId(match)) : null;
  if (!history || !match.history_message_id) return;
  await editPanelById(history, match.history_message_id, revertedPanel(match)).catch((error: unknown) =>
    log.warn('history post not redrawn', match.match_id, reason(error)),
  );
}
