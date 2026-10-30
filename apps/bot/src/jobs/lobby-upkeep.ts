import type { Client } from 'discord.js';

import { ApiClient } from '../api/index.js';
import { advanceLobby, closeVote } from '../services/lobby-vote.service.js';
import { advanceVote } from '../services/vote.service.js';
import { showLobby } from '../services/lobby.service.js';
import { inSetupTurn } from '../services/turns.js';
import { log } from '../utils/log.js';

const INTERVAL_MS = 30_000;

// Every 30 seconds: idle lobbies close, freeing their seats, and a countdown,
// vote or blind picks a restart left past its time moves on.
export function startLobbyUpkeepJob(client: Client): () => void {
  const api = new ApiClient();
  let running = false;
  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      for (const lobby of await api.closeIdleLobbies()) {
        await inSetupTurn(lobby.id, async () => {
          await showLobby(client, lobby, api);
          await closeVote(client, lobby);
        }).catch((error: unknown) => log.warn('idle lobby post not updated', lobby.id, error));
      }
      for (const lobby of await api.lobbiesDue()) {
        await inSetupTurn(lobby.id, () => advanceLobby(client, lobby.id, api)).catch((error: unknown) => log.warn('due lobby not advanced', lobby.id, error));
      }
      for (const vote of await api.votesDue()) {
        await inSetupTurn(vote.id, () => advanceVote(client, vote.id, api)).catch((error: unknown) => log.warn('due vote not advanced', vote.id, error));
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
