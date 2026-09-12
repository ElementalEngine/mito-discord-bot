import assert from 'node:assert/strict';
import { createServer as httpServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';

import { RateLimiter } from './ratelimit.js';
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
    res.end('{"echo":true}');
  });
  const baseUrl = await listen(fake);
  activity = createServer({
    upstream: { baseUrl, bearer: 'service-secret' },
    sessionSigningKey: KEY,
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
