import { ApiClient } from '../api/index.js';
import { log } from '../utils/log.js';

const INTERVAL_MS = 15 * 60_000;

// An hour-old lobby nobody touched blocks every player seated in it, because
// a player holds one seat at a time. The sweep is the outer bound; a host or
// staff member who knows it is dead uses /lobby cancel instead.
export function startSweepStaleLobbiesJob(): () => void {
  const api = new ApiClient();
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const closed = await api.sweepStaleLobbies();
      if (closed > 0) log.info('swept stale lobbies', closed);
    } catch (error) {
      log.error('sweep-stale-lobbies tick failed', error);
    } finally {
      running = false;
    }
  };
  const interval = setInterval(() => void tick(), INTERVAL_MS);
  void tick();
  return () => clearInterval(interval);
}
