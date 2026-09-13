import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';

import { CivDataCache } from './civ-data.js';

let fake: Server;
let baseUrl = '';
let fetches = 0;
let upstreamStatus = 200;

before(async () => {
  fake = createServer((req, res) => {
    fetches += 1;
    res.writeHead(upstreamStatus, { 'Content-Type': 'application/json' });
    res.end(`{"edition":"civ6","fetch":${fetches},"auth":"${req.headers.authorization}"}`);
  });
  await new Promise<void>((resolve) => fake.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
});
after(() => fake.close());

test('one upstream fetch serves every read inside the TTL', async () => {
  const cache = new CivDataCache({ baseUrl, bearer: 'svc' }, 1000);
  const first = await cache.get('civ6', 0);
  const second = await cache.get('civ6', 999);
  assert.equal(first.status, 200);
  assert.equal(second.body?.toString(), first.body?.toString());
  assert.equal(fetches, 1);
  assert.match(first.body?.toString() ?? '', /"auth":"Bearer svc"/);
});

test('a lapsed TTL refreshes once', async () => {
  const cache = new CivDataCache({ baseUrl, bearer: 'svc' }, 1000);
  await cache.get('civ6', 0);
  const before = fetches;
  await cache.get('civ6', 1000);
  assert.equal(fetches, before + 1);
});

test('a failed refresh serves the stale entry', async () => {
  const cache = new CivDataCache({ baseUrl, bearer: 'svc' }, 1000);
  const warm = await cache.get('civ6', 0);
  upstreamStatus = 503;
  const served = await cache.get('civ6', 5000);
  upstreamStatus = 200;
  assert.equal(served.status, 200);
  assert.equal(served.body?.toString(), warm.body?.toString());
});

test('a cold cache with a failing upstream is 503', async () => {
  const cache = new CivDataCache({ baseUrl, bearer: 'svc' }, 1000);
  upstreamStatus = 503;
  const served = await cache.get('civ7', 0);
  upstreamStatus = 200;
  assert.deepEqual(served, { status: 503, body: null });
});

test('editions are cached separately', async () => {
  const cache = new CivDataCache({ baseUrl, bearer: 'svc' }, 1000);
  await cache.get('civ6', 0);
  const before = fetches;
  await cache.get('civ7', 0);
  assert.equal(fetches, before + 1);
});
