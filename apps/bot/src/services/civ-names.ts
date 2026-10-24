import type { Client } from 'discord.js';

import { ApiClient } from '../api/index.js';
import type { CivDataResponse } from '../api/types.js';
import { civNamesOf, type CivNames } from '../ui/kit/index.js';
import { log } from '../utils/log.js';

export type CivEditionKey = 'civ6' | 'civ7';

const TTL_MS = 10 * 60_000;
let emojis: ReadonlyMap<string, string> = new Map();
// Names built with an older emoji set are stale, however recent.
const cache = new Map<CivEditionKey, { at: number; emojis: typeof emojis; names: CivNames; data: CivDataResponse }>();

// The bot's own emoji by name, read once at startup. Without them names
// show without portraits; nothing else changes.
export async function loadAppEmojis(client: Client): Promise<void> {
  try {
    const own = (await client.application?.emojis.fetch()) ?? new Map();
    emojis = new Map([...own.values()].flatMap((e) => (e.name ? [[e.name, e.id] as [string, string]] : [])));
    log.info(`Loaded ${emojis.size} application emojis`);
  } catch (error) {
    log.warn('application emojis unavailable', error instanceof Error ? error.message : error);
  }
}

// What players call each leader and civ, from core-api's civ data. Names past
// their time are served at once and refreshed behind; a failure keeps them.
export async function civNames(edition: CivEditionKey, api = new ApiClient(), now = Date.now()): Promise<CivNames> {
  const held = cache.get(edition);
  if (held && held.emojis === emojis) {
    if (now - held.at >= TTL_MS) {
      cache.set(edition, { ...held, at: now });
      void fetchNames(edition, api, now);
    }
    return held.names;
  }
  return fetchNames(edition, api, now);
}

async function fetchNames(edition: CivEditionKey, api: ApiClient, now: number): Promise<CivNames> {
  const held = cache.get(edition);
  try {
    const own = emojis;
    const data = await api.getCivData(edition);
    const names = civNamesOf(data, own);
    cache.set(edition, { at: now, emojis: own, names, data });
    return names;
  } catch (error) {
    log.warn('civ-data unavailable, using token names', edition, error instanceof Error ? error.message : error);
    return held?.names ?? new Map();
  }
}

// The edition's leaders and civs as core-api serves them, cached with the names.
export async function civRows(edition: CivEditionKey, api = new ApiClient()): Promise<CivDataResponse> {
  return cache.get(edition)?.data ?? api.getCivData(edition);
}

export function editionOf(game: string): CivEditionKey {
  return game.toLowerCase() === 'civ7' ? 'civ7' : 'civ6';
}

export function forgetCivNames(): void {
  cache.clear();
}
