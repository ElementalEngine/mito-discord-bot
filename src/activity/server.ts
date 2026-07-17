import { createServer } from 'node:http';
import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { Duplex } from 'node:stream';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';

import { activityConfig, validateActivityConfig } from './config.js';
import { admitConnection } from './auth/admission.js';
import type { AdmissionRefusal } from './auth/admission.js';
import { ActivityHub } from './hub.js';
import type { HubConnection } from './hub.js';
import { parseClientMessage } from './protocol.js';
import type { ServerMessage } from './protocol.js';
import { createDevRouter } from './dev.js';
import { SMOKE_PAGE_HTML } from './smoke-page.js';
import { error as logError, log as logInfo, warn as logWarn } from '../core/logging.js';

const WS_PATH_PREFIX = '/session/';

export interface ActivityServer {
  readonly hub: ActivityHub;
  /** Begin listening; resolves once bound. */
  listen(): Promise<void>;
  /** Stop listening and dispose all sessions/connections. */
  close(): Promise<void>;
}

export function createActivityServer(hub: ActivityHub): ActivityServer {
  validateActivityConfig(); // fail LOUD before binding if the secret is missing/short

  const app = express();
  app.disable('x-powered-by');
  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: 120,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
    }),
  );
  app.get('/healthz', (_req, res) => {
    res.json({ ok: true });
  });

  // Dev-only QA harness: token/session endpoints + the smoke page. Never in prod.
  if (activityConfig.devTokenEndpointEnabled) {
    app.use(express.json({ limit: '16kb' }));
    app.use('/dev', createDevRouter(hub));
    app.get('/', (_req, res) => {
      res.type('html').send(SMOKE_PAGE_HTML);
    });
    logWarn('[activity] DEV endpoints + smoke page ENABLED (ACTIVITY_DEV_TOKENS=1). Do not use in prod.');
  }

  const httpServer: HttpServer = createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req, socket, head) => {
    void handleUpgrade(wss, hub, req, socket, head);
  });

  return {
    hub,
    listen: () =>
      new Promise<void>((resolve) => {
        httpServer.listen(activityConfig.port, '127.0.0.1', () => {
          logInfo(`🎮 Activity server listening on 127.0.0.1:${activityConfig.port}`);
          resolve();
        });
      }),
    close: () =>
      new Promise<void>((resolve) => {
        hub.disposeAll();
        wss.close(() => {
          httpServer.close(() => resolve());
        });
      }),
  };
}

// ── Upgrade + admission ──────────────────────────────────────────────────────

interface UpgradeContext {
  sessionId: string;
  userId: string;
  staff: boolean;
}

async function handleUpgrade(
  wss: WebSocketServer,
  hub: ActivityHub,
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
): Promise<void> {
  try {
    const url = new URL(req.url ?? '', 'http://localhost');
    if (!url.pathname.startsWith(WS_PATH_PREFIX)) {
      return rejectUpgrade(socket, 404, 'Not Found');
    }
    const sessionId = decodeURIComponent(url.pathname.slice(WS_PATH_PREFIX.length)).trim();
    if (!sessionId) return rejectUpgrade(socket, 400, 'Bad Request');

    const actor = hub.getSession(sessionId);
    if (!actor) return rejectUpgrade(socket, 404, 'Not Found');

    // Browser WebSocket can't set headers → tokens ride the query string (over wss/TLS via Caddy).
    const identityToken = url.searchParams.get('identity');
    const roomAccessToken = url.searchParams.get('access');

    const result = admitConnection({
      secret: activityConfig.sessionSecret,
      room: actor.snapshot(),
      identityToken,
      roomAccessToken,
    });
    if (!result.ok) {
      logWarn(`[activity] admission refused for session ${sessionId}: ${refusalReason(result.refusal)}`);
      return rejectUpgrade(socket, admissionHttpStatus(result.refusal), 'Unauthorized');
    }

    const ctx: UpgradeContext = { sessionId, userId: result.identity.sub, staff: result.identity.staff === true };
    wss.handleUpgrade(req, socket, head, (ws) => {
      wireSocket(hub, ws, ctx);
    });
  } catch (err) {
    logError('[activity] upgrade error', err);
    rejectUpgrade(socket, 500, 'Internal Server Error');
  }
}

function wireSocket(hub: ActivityHub, socket: WebSocket, ctx: UpgradeContext): void {
  const connection: HubConnection = {
    userId: ctx.userId,
    staff: ctx.staff,
    send(message: ServerMessage) {
      if (socket.readyState !== socket.OPEN) return;
      try {
        socket.send(JSON.stringify(message));
      } catch (err) {
        logWarn('[activity] send failed', err);
      }
    },
    close(code: number, reason: string) {
      try {
        socket.close(code, reason);
      } catch {
        // socket already closing/closed — nothing to do
      }
    },
  };

  hub.attach(ctx.sessionId, connection);

  socket.on('message', (data) => {
    void handleMessage(hub, ctx, connection, data.toString());
  });
  socket.on('close', () => {
    hub.detach(ctx.sessionId, connection);
  });
  socket.on('error', (err) => {
    logWarn('[activity] socket error', err);
    hub.detach(ctx.sessionId, connection);
  });
}

async function handleMessage(
  hub: ActivityHub,
  ctx: UpgradeContext,
  connection: HubConnection,
  raw: string,
): Promise<void> {
  const parsed = parseClientMessage(raw, ctx.userId);
  if (!parsed.ok) {
    connection.send({ type: 'reject', code: 'BAD_MESSAGE', message: parsed.reason });
    return;
  }
  const response = await hub.submit(ctx.sessionId, parsed.command);
  if (response.ok) {
    connection.send({ type: 'ack', ok: true });
  } else {
    connection.send({ type: 'reject', code: response.code, message: response.message });
  }
  // STATE_CHANGED fan-out to every recipient happens via the hub's executeEffects.
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function rejectUpgrade(socket: Duplex, status: number, message: string): void {
  socket.write(`HTTP/1.1 ${status} ${message}\r\n\r\n`);
  socket.destroy();
}

function admissionHttpStatus(refusal: AdmissionRefusal): number {
  switch (refusal.kind) {
    case 'unauthenticated':
      return 401;
    case 'forbidden':
    case 'observer-forbidden':
    case 'observer-is-seated':
      return 403;
    default:
      return 403;
  }
}

function refusalReason(refusal: AdmissionRefusal): string {
  switch (refusal.kind) {
    case 'unauthenticated':
      return `unauthenticated (${refusal.reason})`;
    case 'forbidden':
      return `forbidden (${refusal.reason})`;
    case 'observer-forbidden':
      return 'observer-forbidden';
    case 'observer-is-seated':
      return 'observer-is-seated';
    default:
      return 'refused';
  }
}
