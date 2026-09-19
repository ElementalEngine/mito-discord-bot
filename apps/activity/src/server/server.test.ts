import assert from 'node:assert/strict';
import { createServer as httpServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';

import { RateLimiter } from './rate-limit.js';
import { createServer } from './server.js';
import { mint } from './session.js';

const KEY = 'test-key';
const ID = '507f1f77bcf86cd799439011';
type Seen = { url: string; headers: IncomingMessage['headers'] };
const seen: Seen[] = [];
let fake: Server;
let activity: Server;
let base = '';

function listen(server: Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    });
  });
}

before(async () => {
  fake = httpServer((req, res) => {
    seen.push({ url: req.url ?? '', headers: req.headers });
    if (req.url?.includes('since=')) return res.writeHead(204).end();
    if (req.url?.endsWith('/cancel')) {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      return res.end('{"detail":{"error":{"code":"CONFLICT","retryable":false}}}');
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });

    return res.end('{"echo":true}');
  });
  const baseUrl = await listen(fake);
  activity = createServer({
    upstream: { baseUrl, bearer: 'service-secret' },
    discord: { baseUrl: 'http://127.0.0.1:1', clientId: 'c', clientSecret: 's', guildId: 'g' },
    sessionSigningKey: KEY,
    staffRoleIds: [],
    proxyLimiter: new RateLimiter(2, 60_000),
  });
  base = await listen(activity);
});

after(() => {
  activity.close();
  fake.close();
});

const token = (uid: string, staff = false) => mint({ uid, gid: 'g', staff }, KEY).token;
const call = (path: string, headers: Record<string, string>, method = 'GET') =>
  fetch(`${base}${path}`, { method, headers });

test('no bearer is 401 and never reaches upstream', async () => {
  const res = await call(`/api/lobbies/${ID}`, {});
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { error: { code: 'UNAUTHORIZED', retryable: false } });
  assert.equal(seen.length, 0);
});

test('a tampered token is 401 and never reaches upstream', async () => {
  const res = await call(`/api/lobbies/${ID}`, { Authorization: `Bearer ${token('u')}x` });
  assert.equal(res.status, 401);
  assert.equal(seen.length, 0);
});

test('a valid token on a path outside the allowlist is 404, never upstream', async () => {
  const res = await call('/api/lobbies/claim-post', { Authorization: `Bearer ${token('u1')}` }, 'POST');
  assert.equal(res.status, 404);
  assert.equal(seen.length, 0);
});

test('identity is stamped from the claims; client headers never arrive', async () => {
  const res = await call(`/api/lobbies/${ID}`, {
    Authorization: `Bearer ${token('honest')}`,
    'X-Actor-Discord-Id': 'attacker',
    'X-Actor-Is-Staff': 'true',
    Cookie: 'leak=1',
  });
  assert.equal(res.status, 200);
  const got = seen.at(-1)!;
  assert.equal(got.url, `/api/v2/lobbies/${ID}`);
  assert.equal(got.headers.authorization, 'Bearer service-secret');
  assert.equal(got.headers['x-actor-discord-id'], 'honest');
  assert.equal(got.headers['x-actor-is-staff'], 'false');
  assert.equal(got.headers.cookie, undefined);
});

test('browse always carries the session guild, whatever the client sent', async () => {
  await call('/api/lobbies?guild_id=someone-elses&edition=civ6', { Authorization: `Bearer ${token('browser')}` });
  const url = new URL(`http://x${seen.at(-1)!.url}`);
  assert.equal(url.pathname, '/api/v2/lobbies');
  assert.equal(url.searchParams.get('guild_id'), 'g');
  assert.equal(url.searchParams.get('edition'), 'civ6');
});

test('a staff claim stamps true', async () => {
  await call(`/api/lobbies/${ID}`, { Authorization: `Bearer ${token('staffer', true)}` });
  assert.equal(seen.at(-1)!.headers['x-actor-is-staff'], 'true');
});

test('a 204 from polling passes through as a 204 with no body', async () => {
  const res = await call(`/api/lobbies/${ID}?since=7`, { Authorization: `Bearer ${token('poller')}` });
  assert.equal(res.status, 204);
  assert.equal(await res.text(), '');
  assert.ok(seen.at(-1)!.url.endsWith('?since=7'));
});

test("core-api's error envelope passes through untouched", async () => {
  const res = await call(`/api/lobbies/${ID}/cancel`, { Authorization: `Bearer ${token('host')}` }, 'POST');
  assert.equal(res.status, 409);
  assert.deepEqual(await res.json(), { detail: { error: { code: 'CONFLICT', retryable: false } } });
});

test('the third request on one token inside the window is 429', async () => {
  const t = token('busy');
  await call(`/api/lobbies/${ID}`, { Authorization: `Bearer ${t}` });
  await call(`/api/lobbies/${ID}`, { Authorization: `Bearer ${t}` });
  const res = await call(`/api/lobbies/${ID}`, { Authorization: `Bearer ${t}` });
  assert.equal(res.status, 429);
  assert.deepEqual(await res.json(), { error: { code: 'RATE_LIMITED', retryable: true } });
});

// A name is Unicode; a header is Latin-1. Undici refused the raw header and
// the catch answered 503 for every player with such a name.
test('a non-Latin name reaches upstream percent-encoded, never as a 503', async () => {
  const t = mint({ uid: 'u-cyr', gid: 'g', staff: false, name: 'Владимир' }, KEY).token;
  const res = await call(`/api/lobbies/${ID}`, { authorization: `Bearer ${t}` });
  assert.equal(res.status, 200);
  const last = seen.at(-1)!;
  assert.equal(last.headers['x-actor-name'], encodeURIComponent('Владимир'));
});

// A proxied body past the cap is refused before it is held in memory.
test('a proxied body over 256 KiB is refused, never forwarded', async () => {
  const before = seen.length;
  const res = await fetch(`${base}/api/lobbies/${ID}/seats`, {
    method: 'PATCH',
    headers: { authorization: `Bearer ${token('u-big')}`, 'content-type': 'application/json' },
    body: '0'.repeat(300 * 1024),
  }).catch(() => null);
  // The socket is destroyed mid-stream; the client sees a reset or a 503.
  assert.ok(res === null || res.status === 503);
  assert.equal(seen.length, before);
});

test('a session body over 16 KiB is a 400, never a Discord call', async () => {
  const res = await fetch(`${base}/api/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: 'x'.repeat(20 * 1024) }),
  }).catch(() => null);
  assert.ok(res === null || res.status === 400);
});
