import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';

import type { config as Config } from './config.js';
import { log } from './log.js';

type Cfg = typeof Config;

// Reachability of core-api, not of this process. No body in either case.
async function healthz(cfg: Cfg, res: ServerResponse): Promise<void> {
  try {
    const upstream = await fetch(`${cfg.coreApiUrl}/healthz`, {
      signal: AbortSignal.timeout(2_000),
    });
    res.writeHead(upstream.ok ? 200 : 503).end();
  } catch {
    res.writeHead(503).end();
  }
}

export function createServer(cfg: Cfg) {
  return createHttpServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://activity');
    if (req.method === 'GET' && url.pathname === '/healthz') {
      void healthz(cfg, res);
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { code: 'NOT_FOUND', retryable: false } }));
  });
}

export function listen(cfg: Cfg): void {
  const server = createServer(cfg);
  server.listen(cfg.port, '127.0.0.1', () => {
    log.info(`activity server listening on 127.0.0.1:${cfg.port} (${cfg.env})`);
  });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      log.info(`${signal} received, closing`);
      server.close(() => process.exit(0));
    });
  }
}
