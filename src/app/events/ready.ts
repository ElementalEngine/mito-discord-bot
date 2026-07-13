import { Events } from 'discord.js';
import type { Client } from 'discord.js';
import { deployCommands } from '../register.js';
import { registerJob, startJobs } from '../../core/scheduling.js';
import { startUpdateLeaderboardsJob } from '../../jobs/update-leaderboard.js';

export const name = Events.ClientReady;
export const once = true;

export async function execute(client: Client): Promise<void> {
  console.log(`🟢 ${client.user?.tag} is online and ready!`);
  try {
    await deployCommands(client.commands);
  } catch (err) {
    console.error('❌ Failed to deploy commands on startup:', err);
  }
  registerJob(startUpdateLeaderboardsJob);
  startJobs(client);
}
