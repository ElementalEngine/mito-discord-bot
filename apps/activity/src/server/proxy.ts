import type { IncomingMessage, ServerResponse } from 'node:http';

import type { Claims } from './session.js';
import { log } from './log.js';

const UPSTREAM_TIMEOUT_MS = 10_000;

export type Upstream = Readonly<{ baseUrl: string; bearer: string }>;

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export function envelope(res: ServerResponse, status: number, code: string, retryable: boolean): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: { code, retryable } }));
}

// Forwards one allowed request. Identity comes from the verified claims and
// nothing else; the client's headers never reach core-api.
export async function forward(
  upstream: Upstream,
  claims: Claims,
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  search: string,
): Promise<void> {
  const method = req.method ?? 'GET';
  const hasBody = method !== 'GET' && method !== 'HEAD';
  const headers: Record<string, string> = {
    Authorization: `Bearer ${upstream.bearer}`,
    Accept: 'application/json',
    'X-Actor-Discord-Id': claims.uid,
    'X-Actor-Is-Staff': claims.staff ? 'true' : 'false',
    'X-Actor-Name': claims.name ?? '',
  };
  if (hasBody) headers['Content-Type'] = req.headers['content-type'] ?? 'application/json';

  let response: Response;
  try {
    response = await fetch(`${upstream.baseUrl}${path}${search}`, {
      method,
      headers,
      body: hasBody ? await readBody(req) : undefined,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (error) {
    log.warn('upstream unreachable', method, path, error instanceof Error ? error.message : error);
    envelope(res, 503, 'UNAVAILABLE', true);
    return;
  }

  const body = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get('content-type');
  res.writeHead(response.status, contentType ? { 'Content-Type': contentType } : {});
  res.end(body.length > 0 ? body : undefined);
}
