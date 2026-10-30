import type { Client } from 'discord.js';

import { ApiClient } from '../api/index.js';
import { config } from '../config.js';
import { publishApproved } from '../services/approval.service.js';
import { syncRankRoles } from '../services/rank-role.service.js';
import { closeEditor, inTurn } from '../services/report.service.js';
import { log } from '../utils/log.js';

const INTERVAL_MS = 60 * 60_000;

// Hourly, and at startup: core-api approves, as the bot, each report needing no
// staff 48 hours after upload, and answers again any it approved unpublished.
export function startAutoApproveJob(client: Client): () => void {
  const api = new ApiClient();
  let running = false;
  const tick = async (): Promise<void> => {
    const botId = client.user?.id;
    if (running || !botId) return;
    running = true;
    try {
      for (const match of await api.autoApprove({ id: botId })) {
        log.info('report auto-approved', match.match_id);
        await inTurn(match.match_id, async () => {
          closeEditor(match.match_id);
          await publishApproved(client, match, api);
          const guild = await client.guilds.fetch(config.discord.guildId).catch(() => null);
          if (guild) await syncRankRoles(guild, match.affected_players, match.match_id);
        }).catch((error: unknown) => log.warn('auto-approved result not published', match.match_id, error));
      }
    } catch (error) {
      log.error('auto-approve tick failed', error);
    } finally {
      running = false;
    }
  };
  const interval = setInterval(() => void tick(), INTERVAL_MS);
  void tick();
  return () => clearInterval(interval);
}
