import type { Client } from 'discord.js';

import { ApiClient } from '../api/index.js';
import { advanceLobby, closeVote } from '../services/lobby-vote.service.js';
import { inLobbyTurn, showLobby } from '../services/lobby.service.js';
import { log } from '../utils/log.js';

const INTERVAL_MS = 5 * 60_000;

// Every five minutes: lobbies idle for 2.5 hours close, freeing their seats,
// and votes or blind picks a restart left past their time are closed.
export function startLobbyUpkeepJob(client: Client): () => void {
  const api = new ApiClient();
  let running = false;
  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      for (const lobby of await api.closeIdleLobbies()) {
        await inLobbyTurn(lobby.id, async () => {
          await showLobby(client, lobby, api);
          await closeVote(client, lobby);
        }).catch((error: unknown) => log.warn('idle lobby post not updated', lobby.id, error));
      }
      for (const lobby of await api.lobbiesDue()) {
        await inLobbyTurn(lobby.id, () => advanceLobby(client, lobby.id, api)).catch((error: unknown) => log.warn('due lobby not advanced', lobby.id, error));
      }
    } catch (error) {
      log.error('lobby upkeep tick failed', error);
    } finally {
      running = false;
    }
  };
  const interval = setInterval(() => void tick(), INTERVAL_MS);
  void tick();
  return () => clearInterval(interval);
}
