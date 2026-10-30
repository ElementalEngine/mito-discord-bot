import { log } from '../utils/log.js';
import { inSetupTurn } from './turns.js';

// Each open lobby's or vote's deadline. After a restart the upkeep job keeps it.
const timers = new Map<string, NodeJS.Timeout>();

export function dropDeadline(id: string): void {
  clearTimeout(timers.get(id));
  timers.delete(id);
}

// The setup moved on, in its turn, at its deadline; any older timer dropped.
export function keepDeadline(id: string, deadline: string | null, advance: () => Promise<void>): void {
  dropDeadline(id);
  if (!deadline) return;
  const ms = Math.max(0, Date.parse(deadline) - Date.now() || 0);
  const timer = setTimeout(() => {
    void inSetupTurn(id, advance).catch((error: unknown) => log.error('not moved on at its deadline', id, error));
  }, ms);
  timer.unref();
  timers.set(id, timer);
}

// A second's grace, for a timer or a core-api clock a moment ahead of ours.
export const isDue = (deadline: string | null): boolean => !!deadline && Date.parse(deadline) <= Date.now() + 1_000;
