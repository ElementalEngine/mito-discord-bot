import assert from 'node:assert/strict';
import { createServer as httpServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';

import { RateLimiter } from './rate-limit.js';
import { createServer } from './server.js';
import { verify } from './session.js';
import { clientIp } from './session-route.js';

const KEY = 'test-key';
const LOBBY = '507f1f77bcf86cd799439011';
let discord: Server;
let activity: Server;
let base = '';
let member = true;
let roles: string[] = [];
let lastExchange = '';

function listen(server: Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`));
  });
}

before(async () => {
  discord = httpServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString();
      const json = (status: number, payload: unknown) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
      };
      if (req.url === '/oauth2/token') {
        lastExchange = body;
        return body.includes('code=good') ? json(200, { access_token: 'ut' }) : json(400, {});
      }
      if (req.headers.authorization !== 'Bearer ut') return json(401, {});
      if (req.url === '/users/@me') return json(200, { id: 'u9', username: 'nine' });
      if (req.url === '/users/@me/guilds/G/member') return member ? json(200, { roles }) : json(404, {});
      json(404, {});
    });
  });
  const discordUrl = await listen(discord);
  activity = createServer({
    upstream: { baseUrl: 'http://127.0.0.1:1', bearer: 'unused' },
    discord: { baseUrl: discordUrl, clientId: 'cid', clientSecret: 'sec', guildId: 'G' },
    sessionSigningKey: KEY,
    staffRoleIds: ['staff-role'],
    sessionLimiter: new RateLimiter(100, 60_000),
  });
  base = await listen(activity);
});
after(() => {
  activity.close();
  discord.close();
});

const mint = (body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${base}/api/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

test('a good code becomes a verifiable session for a member', async () => {
  const res = await mint({ code: 'good' });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const body = (await res.json()) as { token: string; expires_at: string; user: { id: string } };
  const session = verify(body.token, KEY);
  assert.equal(session.ok, true);
  if (!session.ok) return;
  assert.equal(session.claims.uid, 'u9');
  assert.equal(session.claims.gid, 'G');
  assert.equal(session.claims.staff, false);
  assert.equal(body.user.id, 'u9');
  assert.match(lastExchange, /client_id=cid&client_secret=sec&grant_type=authorization_code&code=good/);
});

test('lobby_id is echoed when valid and refused when not', async () => {
  const ok = (await (await mint({ code: 'good', lobby_id: LOBBY })).json()) as { lobby_id?: string };
  assert.equal(ok.lobby_id, LOBBY);
  assert.equal((await mint({ code: 'good', lobby_id: 'not-an-id' })).status, 400);
});

test('no code is 400, a bad code is 401, a non-member is 403', async () => {
  assert.equal((await mint({})).status, 400);
  assert.equal((await mint({ code: 'bad' })).status, 401);
  member = false;
  assert.equal((await mint({ code: 'good' })).status, 403);
  member = true;
});

test('a staff role becomes a staff claim', async () => {
  roles = ['other', 'staff-role'];
  const body = (await (await mint({ code: 'good' })).json()) as { token: string };
  roles = [];
  const session = verify(body.token, KEY);
  assert.equal(session.ok && session.claims.staff, true);
});

test('the mint is limited by client IP', async () => {
  const tight = createServer({
    upstream: { baseUrl: 'http://127.0.0.1:1', bearer: 'unused' },
    discord: { baseUrl: 'http://127.0.0.1:1', clientId: 'c', clientSecret: 's', guildId: 'G' },
    sessionSigningKey: KEY,
    staffRoleIds: [],
    sessionLimiter: new RateLimiter(1, 60_000),
  });
  const url = await listen(tight);
  const post = () => fetch(`${url}/api/session`, { method: 'POST', body: '{}', headers: { 'X-Forwarded-For': '9.9.9.9' } });
  await post();
  assert.equal((await post()).status, 429);
  tight.close();
});

// Behind Cloudflare the first forwarded entry is whatever the client wrote;
// the limiter keyed on it could be evaded.
test('clientIp prefers the proxy header, then the trusted hop, never the client entry', () => {
  const socket = { remoteAddress: '127.0.0.1' };
  assert.equal(clientIp({ headers: { 'cf-connecting-ip': '203.0.113.9' }, socket } as never), '203.0.113.9');
  assert.equal(clientIp({ headers: { 'x-forwarded-for': '1.1.1.1, 203.0.113.9' }, socket } as never), '203.0.113.9');
  assert.equal(clientIp({ headers: {}, socket } as never), '127.0.0.1');
});
