import { ApiClient } from '../api/index.js';
import { civNamesOf, type CivNames } from '../ui/kit/index.js';
import { log } from '../utils/log.js';

export type CivEditionKey = 'civ6' | 'civ7';

const TTL_MS = 10 * 60_000;
const cache = new Map<CivEditionKey, { at: number; names: CivNames }>();

// What players call each leader and civ, from core-api's civ data. A panel
// with token spellings beats no panel, so a failed fetch never throws: it
// keeps the last good names, or none.
export async function civNames(edition: CivEditionKey, api = new ApiClient(), now = Date.now()): Promise<CivNames> {
  const held = cache.get(edition);
  if (held && now - held.at < TTL_MS) return held.names;
  try {
    const names = civNamesOf(await api.getCivData(edition));
    cache.set(edition, { at: now, names });
    return names;
  } catch (error) {
    log.warn('civ-data unavailable, using token names', edition, error instanceof Error ? error.message : error);
    return held?.names ?? new Map();
  }
}

export function editionOf(game: string): CivEditionKey {
  return game.toLowerCase() === 'civ7' ? 'civ7' : 'civ6';
}

export function forgetCivNames(): void {
  cache.clear();
}
