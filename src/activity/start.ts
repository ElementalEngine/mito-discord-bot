import { createSystemClock } from '../session/index.js';
import type { SessionDeps } from '../session/index.js';
import { activityConfig } from './config.js';
import { ActivityHub } from './hub.js';
import { createActivityServer } from './server.js';
import type { ActivityServer } from './server.js';
import { warn as logWarn } from '../core/logging.js';

export async function startActivity(): Promise<ActivityServer | null> {
  if (activityConfig.sessionSecret.trim().length === 0) {
    logWarn('[activity] ACTIVITY_SESSION_SECRET not set — activity server disabled. Set it to enable.');
    return null;
  }

  const deps: SessionDeps = { now: () => Date.now(), rng: () => Math.random() };
  const hub = new ActivityHub({ deps, clock: createSystemClock() });
  const server = createActivityServer(hub);
  await server.listen();
  return server;
}
