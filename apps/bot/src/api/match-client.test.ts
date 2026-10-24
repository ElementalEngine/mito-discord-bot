import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ApiClient } from './client.js';

type Call = { url: string; method: string; headers: Headers; body: unknown };

function recorder(answer: unknown = {}): { client: ApiClient; calls: Call[] } {
  const calls: Call[] = [];
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: init?.body,
    });
    return new Response(JSON.stringify(answer), { status: 200 });
  }) as typeof fetch;
  return { client: new ApiClient('http://core', fetcher, 'token'), calls };
}

const ID = '652f1a2b3c4d5e6f7a8b9c0d';

test('editing seats sends the declarative patch with the actor', async () => {
  const { client, calls } = recorder();
  await client.editSeats(ID, [{ seat: 2, discord_id: '100' }], { id: '7' });
  const [call] = calls;
  assert.equal(call?.method, 'PATCH');
  assert.equal(call?.url, `http://core/api/v2/matches/${ID}/players`);
  assert.equal(call?.headers.get('x-actor-discord-id'), '7');
  assert.equal(call?.headers.get('x-actor-is-staff'), null);
  assert.deepEqual(JSON.parse(String(call?.body)), { players: [{ seat: 2, discord_id: '100' }] });
});

test('staff is asserted only when the actor is staff', async () => {
  const { client, calls } = recorder();
  await client.approve(ID, { id: '7', isStaff: true });
  await client.removeMatch(ID, { id: '8', isStaff: false });
  assert.equal(calls[0]?.method, 'POST');
  assert.equal(calls[0]?.url, `http://core/api/v2/matches/${ID}/approve`);
  assert.equal(calls[0]?.headers.get('x-actor-is-staff'), 'true');
  assert.equal(calls[1]?.method, 'DELETE');
  assert.equal(calls[1]?.url, `http://core/api/v2/matches/${ID}`);
  assert.equal(calls[1]?.headers.get('x-actor-is-staff'), null);
});

test('a contest carries its reason; a revert carries nothing', async () => {
  const { client, calls } = recorder();
  await client.contest(ID, 'wrong order', { id: '9' });
  await client.revert(ID);
  assert.equal(calls[0]?.url, `http://core/api/v2/matches/${ID}/contest`);
  assert.deepEqual(JSON.parse(String(calls[0]?.body)), { reason: 'wrong order' });
  assert.equal(calls[1]?.url, `http://core/api/v2/matches/${ID}/revert`);
  assert.equal(calls[1]?.body, undefined);
});

test('reads escape the id and the query', async () => {
  const { client, calls } = recorder();
  await client.match('a/b');
  await client.subQuota('123456789012345678');
  assert.equal(calls[0]?.url, 'http://core/api/v2/matches/a%2Fb');
  assert.equal(calls[1]?.url, 'http://core/api/v2/matches/sub-quota?discord_id=123456789012345678');
  assert.equal(calls[1]?.method, 'GET');
});

test('an upload is multipart, with the reporter as actor', async () => {
  const { client, calls } = recorder({ match_id: ID, repeated: false });
  const out = await client.uploadMatch(Buffer.from('CIV6'), 'game.Civ6Save', '7', true, '555');
  const [call] = calls;
  assert.equal(call?.method, 'POST');
  assert.equal(call?.url, 'http://core/api/v2/matches');
  assert.equal(call?.headers.get('x-actor-discord-id'), '7');
  const body = call?.body;
  assert.ok(body instanceof FormData);
  assert.equal(body.get('is_cloud'), '1');
  assert.equal(body.get('discord_message_id'), '555');
  assert.equal(out.repeated, false);
});
