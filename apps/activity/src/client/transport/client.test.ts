import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ApiClient, ApiError, SessionExpired } from './client.js';

type Step = { status: number; body?: string };
function fake(steps: Step[]) {
  const calls: Array<{ url: string; auth: string | undefined }> = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    const step = steps.shift() ?? { status: 500 };
    const headers = init?.headers as Record<string, string> | undefined;
    calls.push({ url: String(url), auth: headers?.Authorization });
    return new Response(step.status === 204 ? null : (step.body ?? ''), { status: step.status });
  }) as typeof fetch;
  return { impl, calls };
}
function store(initial: string | null) {
  let token = initial;
  return { get: () => token, set: (t: string) => void (token = t) };
}

test('a 200 returns the body with the bearer attached', async () => {
  const f = fake([{ status: 200, body: '{"revision":3}' }]);
  const client = new ApiClient('/api', store('tok'), async () => 'unused', f.impl);
  const reply = await client.request<{ revision: number }>('GET', '/lobbies/x');
  assert.deepEqual(reply, { status: 200, body: { revision: 3 } });
  assert.equal(f.calls[0]?.auth, 'Bearer tok');
});

test('a 204 is a null body, not an error', async () => {
  const f = fake([{ status: 204 }]);
  const client = new ApiClient('/api', store('tok'), async () => 'unused', f.impl);
  assert.deepEqual(await client.request('GET', '/lobbies/x?since=3'), { status: 204, body: null });
});

test('one 401 re-mints once and retries with the new token', async () => {
  const f = fake([{ status: 401 }, { status: 200, body: '{}' }]);
  let mints = 0;
  const client = new ApiClient('/api', store('old'), async () => (mints += 1, 'new'), f.impl);
  await client.request('GET', '/lobbies/x');
  assert.equal(mints, 1);
  assert.deepEqual(f.calls.map((c) => c.auth), ['Bearer old', 'Bearer new']);
});

test('two 401s is SessionExpired, and the re-mint still ran exactly once', async () => {
  const f = fake([{ status: 401 }, { status: 401 }]);
  let mints = 0;
  const client = new ApiClient('/api', store('old'), async () => (mints += 1, 'new'), f.impl);
  await assert.rejects(client.request('GET', '/lobbies/x'), SessionExpired);
  assert.equal(mints, 1);
  assert.equal(f.calls.length, 2);
});

test('both envelope shapes become an ApiError with code and retryable', async () => {
  const f = fake([
    { status: 409, body: '{"detail":{"error":{"code":"CONFLICT","retryable":false}}}' },
    { status: 503, body: '{"error":{"code":"UNAVAILABLE","retryable":true}}' },
  ]);
  const client = new ApiClient('/api', store('tok'), async () => 'unused', f.impl);
  await assert.rejects(client.request('POST', '/x'), (e: unknown) =>
    e instanceof ApiError && e.status === 409 && e.code === 'CONFLICT' && !e.retryable);
  await assert.rejects(client.request('POST', '/x'), (e: unknown) =>
    e instanceof ApiError && e.status === 503 && e.code === 'UNAVAILABLE' && e.retryable);
});
