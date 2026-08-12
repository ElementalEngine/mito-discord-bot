import type { Client } from 'discord.js';

import { startUpdateLeaderboardsJob } from './update-leaderboard.js';

type StopFn = () => void;

let stopAll: StopFn | null = null;

export function startJobs(client: Client): void {
  if (stopAll) return;

  const stops: StopFn[] = [startUpdateLeaderboardsJob(client)];

  stopAll = () => {
    for (const stop of stops) {
      try {
        stop();
      } catch (err) {
        console.error('Job stop failed:', err);
      }
    }
    stopAll = null;
  };
}

export function stopJobs(): void {
  stopAll?.();
}
