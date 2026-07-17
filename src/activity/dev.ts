import { Router } from 'express';
import type { Request, Response } from 'express';
import { randomBytes } from 'node:crypto';

import { createRoomRecord } from '../session/index.js';
import { activityConfig } from './config.js';
import { createIdentityToken, createRoomAccessToken } from './auth/tokens.js';
import type { ActivityHub } from './hub.js';
import { buildDevConfig, normalizeEdition, normalizeGameType, normalizeDraftMode } from './dev-config.js';
import { warn as logWarn } from '../core/logging.js';

interface CreateSessionBody {
  edition?: string;
  gameType?: string;
  draftMode?: string;
  hostId?: string;
}

interface TokenBody {
  userId?: string;
  sessionId?: string;
  staff?: boolean;
}

export function createDevRouter(hub: ActivityHub): Router {
  const router = Router();

  // POST /dev/session → create a throwaway session actor, return its id.
  router.post('/session', (req: Request, res: Response) => {
    const body = (req.body ?? {}) as CreateSessionBody;
    const hostId = isNonEmptyString(body.hostId) ? body.hostId : 'dev-host';
    const params = {
      edition: normalizeEdition(body.edition),
      gameType: normalizeGameType(body.gameType),
      draftMode: normalizeDraftMode(body.draftMode),
      hostId,
    };

    const sessionId = randomBytes(16).toString('hex');
    hub.createSession(createRoomRecord({ id: sessionId, config: buildDevConfig(params), createdAt: Date.now() }));

    logWarn(`[activity:dev] created throwaway session ${sessionId} (${params.edition}/${params.gameType}/${params.draftMode})`);
    res.json({ sessionId, ...params });
  });

  // POST /dev/token → mint identity + room-access tokens for a made-up user + session.
  router.post('/token', (req: Request, res: Response) => {
    const body = (req.body ?? {}) as TokenBody;
    if (!isNonEmptyString(body.userId) || !isNonEmptyString(body.sessionId)) {
      res.status(400).json({ error: 'userId and sessionId are required' });
      return;
    }
    const staff = body.staff === true;
    const identity = createIdentityToken(
      activityConfig.sessionSecret,
      { userId: body.userId, staff },
      { ttlSeconds: activityConfig.identityTtlSeconds },
    );
    const access = createRoomAccessToken(
      activityConfig.sessionSecret,
      { userId: body.userId, sessionId: body.sessionId },
      { ttlSeconds: activityConfig.roomAccessTtlSeconds },
    );
    res.json({ identity, access, userId: body.userId, sessionId: body.sessionId, staff });
  });

  return router;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
