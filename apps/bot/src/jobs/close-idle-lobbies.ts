import type { Client } from 'discord.js';

import { ApiClient } from '../api/index.js';
import { showLobby } from '../services/lobby.service.js';
import { log } from '../utils/log.js';

const INTERVAL_MS = 5 * 60_000;

// A lobby with no activity for 2.5 hours closes, freeing its players' seats;
// its post then says so.
export function startCloseIdleLobbiesJob(client: Client): () => void {
  const api = new ApiClient();
  let running = false;
  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      for (const lobby of await api.closeIdleLobbies()) {
        await showLobby(client, lobby, api).catch((error: unknown) => log.warn('idle lobby post not updated', lobby.id, error));
      }
    } catch (error) {
      log.error('close-idle-lobbies tick failed', error);
    } finally {
      running = false;
    }
  };
  const interval = setInterval(() => void tick(), INTERVAL_MS);
  void tick();
  return () => clearInterval(interval);
}
