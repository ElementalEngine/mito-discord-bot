import type { Client } from 'discord.js';
import { error as logError } from './logging.js';

type StopFn = () => void;
export type JobFactory = (client: Client) => StopFn;

const factories: JobFactory[] = [];
let stopAll: StopFn | null = null;

export function registerJob(factory: JobFactory): void {
  factories.push(factory);
}

export function startJobs(client: Client): void {
  if (stopAll) return;

  const stops = factories.map((factory) => factory(client));

  stopAll = () => {
    for (const stop of stops) {
      try {
        stop();
      } catch (err) {
        logError('Job stop failed:', err);
      }
    }
    stopAll = null;
  };
}

export function stopJobs(): void {
  stopAll?.();
}
