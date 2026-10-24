import { Events } from 'discord.js';
import type { Client } from 'discord.js';
import { deployCommands } from '../deploy.js';
import { checkCommandAccess } from '../services/command-access.service.js';
import { loadAppEmojis } from '../services/civ-names.js';
import { draftSettings } from '../services/draft.service.js';
import { startJobs } from '../jobs/index.js';
import { log } from '../utils/log.js';

export const name = Events.ClientReady;
export const once = true;

export async function execute(client: Client): Promise<void> {
  log.info(`🟢 ${client.user?.tag} is online and ready!`);
  // Without core-api's settings /draft would lose its options, so Discord
  // keeps the commands it has until the next start.
  if (!draftSettings()) {
    log.warn('draft settings unread: commands not redeployed');
  } else {
    try {
      await deployCommands(client.commands);
    } catch (err) {
      log.error('❌ Failed to deploy commands on startup:', err);
    }
  }
  await checkCommandAccess(client).catch((error: unknown) => {
    log.warn('command access not checked', error instanceof Error ? error.message : error);
  });
  await loadAppEmojis(client);
  startJobs(client);
}
