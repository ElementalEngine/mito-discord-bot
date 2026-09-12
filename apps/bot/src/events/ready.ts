import { Events } from 'discord.js';
import type { Client } from 'discord.js';
import { deployCommands } from '../deploy.js';
import { startJobs } from '../jobs/index.js';
import { log } from '../utils/log.js';

export const name = Events.ClientReady;
export const once = true;

export async function execute(client: Client): Promise<void> {
  log.info(`🟢 ${client.user?.tag} is online and ready!`);
  try {
    await deployCommands(client.commands);
  } catch (err) {
    log.error('❌ Failed to deploy commands on startup:', err);
  }
  startJobs(client);
}
