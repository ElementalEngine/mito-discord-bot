import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { upstreamPath } from './allowlist.js';
import { CivDataCache, isEdition } from './civdata.js';
import type { DiscordApp } from './discord.js';
import { log } from './log.js';
import { envelope, forward, type Upstream } from './proxy.js';
import { RateLimiter } from './ratelimit.js';
import { verify } from './session.js';
import { clientIp, handleSession } from './session-route.js';

export type ServerDeps = Readonly<{
  upstream: Upstream;
  discord: DiscordApp;
  sessionSigningKey: string;
  staffRoleIds: readonly string[];
  proxyLimiter?: RateLimiter;
  sessionLimiter?: RateLimiter;
  civData?: CivDataCache;
}>;

async function healthz(upstream: Upstream, res: ServerResponse): Promise<void> {
  try {
    const reply = await fetch(`${upstream.baseUrl}/healthz`, { signal: AbortSignal.timeout(2_000) });
    res.writeHead(reply.ok ? 200 : 503).end();
  } catch {
    res.writeHead(503).end();
  }
}

function bearer(req: IncomingMessage): string | null {
  const header = req.headers.authorization ?? '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
}

export function createServer(deps: ServerDeps) {
  const limiter = deps.proxyLimiter ?? new RateLimiter(120, 60_000);
  const civData = deps.civData ?? new CivDataCache(deps.upstream);
  const mintLimiter = deps.sessionLimiter ?? new RateLimiter(10, 60_000);

  return createHttpServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://activity');
    const method = req.method ?? 'GET';

    if (method === 'GET' && url.pathname === '/healthz') {
      void healthz(deps.upstream, res);
      return;
    }

    if (method === 'POST' && url.pathname === '/api/session') {
      if (!mintLimiter.allow(clientIp(req))) return envelope(res, 429, 'RATE_LIMITED', true);
      void handleSession(
        { discord: deps.discord, sessionSigningKey: deps.sessionSigningKey, staffRoleIds: deps.staffRoleIds },
        req,
        res,
      );
      return;
    }

    if (method === 'GET' && url.pathname.startsWith('/api/civ-data/')) {
      const token = bearer(req);
      if (!token || !verify(token, deps.sessionSigningKey).ok) {
        return envelope(res, 401, 'UNAUTHORIZED', false);
      }
      const edition = url.pathname.slice('/api/civ-data/'.length);
      if (!isEdition(edition)) return envelope(res, 404, 'NOT_FOUND', false);
      void civData.get(edition).then(({ status, body }) => {
        if (body === null) return envelope(res, status, 'UNAVAILABLE', true);
        res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'private, max-age=300' });
        res.end(body);
      });
      return;
    }

    if (url.pathname.startsWith('/api/lobbies')) {
      const token = bearer(req);
      if (!token) return envelope(res, 401, 'UNAUTHORIZED', false);
      const session = verify(token, deps.sessionSigningKey);
      if (!session.ok) return envelope(res, 401, 'UNAUTHORIZED', false);
      if (!limiter.allow(token)) return envelope(res, 429, 'RATE_LIMITED', true);
      const path = upstreamPath(method, url.pathname);
      if (path === null) return envelope(res, 404, 'NOT_FOUND', false);
      // The guild comes from the session, like identity: a client never browses another.
      if (path === '/api/v2/lobbies') url.searchParams.set('guild_id', session.claims.gid);
      void forward(deps.upstream, session.claims, req, res, path, url.search);
      return;
    }

    envelope(res, 404, 'NOT_FOUND', false);
  });
}

export function listen(deps: ServerDeps, port: number, env: string): void {
  const server = createServer(deps);
  server.listen(port, '127.0.0.1', () => {
    log.info(`activity server listening on 127.0.0.1:${port} (${env})`);
  });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      log.info(`${signal} received, closing`);
      server.close(() => process.exit(0));
    });
  }
}
