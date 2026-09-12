import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ApiClient, ApiError } from '../api/client.js';
import { subscribe } from './poll.js';

function client(replies: Array<{ status: number; body?: string }>) {
  const urls: string[] = [];
  const impl = (async (url: string | URL | Request) => {
    urls.push(String(url));
    const r = replies.shift() ?? { status: 500 };
    return new Response(r.status === 204 ? null : (r.body ?? ''), { status: r.status });
  }) as typeof fetch;
  const api = new ApiClient('/api', { get: () => 't', set: () => {} }, async () => 't', impl);
  return { api, urls };
}
const now = async () => {};

test('polls with since, skips 204s, and stops at a terminal phase', async () => {
  const { api, urls } = client([
    { status: 200, body: '{"_id":"L","revision":1,"phase":"lobby"}' },
    { status: 204 },
    { status: 200, body: '{"_id":"L","revision":4,"phase":"settings"}' },
    { status: 200, body: '{"_id":"L","revision":9,"phase":"complete"}' },
    { status: 200, body: '{"_id":"L","revision":99,"phase":"complete"}' },
  ]);
  const phases: string[] = [];
  const sub = subscribe(api, 'L', (l) => phases.push(l.phase), () => {}, 0, now);
  await sub.done;
  assert.deepEqual(phases, ['lobby', 'settings', 'complete']);
  assert.deepEqual(urls, ['/api/lobbies/L', '/api/lobbies/L?since=1', '/api/lobbies/L?since=1', '/api/lobbies/L?since=4']);
});

test('cancelled is terminal too', async () => {
  const { api, urls } = client([{ status: 200, body: '{"_id":"L","revision":1,"phase":"cancelled"}' }]);
  const sub = subscribe(api, 'L', () => {}, () => {}, 0, now);
  await sub.done;
  assert.equal(urls.length, 1);
});

test('an error stops the poll and is reported once', async () => {
  const { api } = client([{ status: 404, body: '{"detail":{"error":{"code":"NOT_FOUND","retryable":false}}}' }]);
  const errors: unknown[] = [];
  const sub = subscribe(api, 'L', () => {}, (e) => errors.push(e), 0, now);
  await sub.done;
  assert.equal(errors.length, 1);
  assert.ok(errors[0] instanceof ApiError && errors[0].status === 404);
});

test('stop() ends the loop before the next poll', async () => {
  const { api, urls } = client([{ status: 200, body: '{"_id":"L","revision":1,"phase":"lobby"}' }, { status: 204 }]);
  const sub = subscribe(api, 'L', () => sub.stop(), () => {}, 0, now);
  await sub.done;
  assert.equal(urls.length, 1);
});
