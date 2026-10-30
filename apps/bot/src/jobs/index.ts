import type { Client } from 'discord.js';

import { startAutoApproveJob } from './auto-approve.js';
import { startLobbyUpkeepJob } from './lobby-upkeep.js';
import { startUpdateLeaderboardsJob } from './update-leaderboard.js';
import { log } from '../utils/log.js';

type StopFn = () => void;

let stopAll: StopFn | null = null;

export function startJobs(client: Client): void {
  if (stopAll) return;

  const stops: StopFn[] = [startUpdateLeaderboardsJob(client), startLobbyUpkeepJob(client), startAutoApproveJob(client)];

  stopAll = () => {
    for (const stop of stops) {
      try {
        stop();
      } catch (err) {
        log.error('Job stop failed:', err);
      }
    }
    stopAll = null;
  };
}

export function stopJobs(): void {
  stopAll?.();
}
