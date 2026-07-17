import { test } from 'node:test';
import assert from 'node:assert/strict';

import { setActivityBridge, getActivityBridge } from '../../src/core/activity-bridge.js';
import { buildLaunch } from '../../src/activity/launch.js';
import { admitConnection } from '../../src/activity/auth/admission.js';

const SECRET = 'launch-secret-at-least-32-chars-abcdef';
const OPTIONS = {
  publicUrl: 'https://dev-activity.example.net',
  secret: SECRET,
  identityTtlSeconds: 3600,
  roomAccessTtlSeconds: 3600,
};

test('the core bridge registry set/get round-trips', () => {
  assert.equal(getActivityBridge(), null);
  const stub = { launch: () => null };
  setActivityBridge(stub);
  assert.equal(getActivityBridge(), stub);
  setActivityBridge(null);
  assert.equal(getActivityBridge(), null);
});

test('buildLaunch returns null without a public URL', () => {
  const out = buildLaunch(
    { guildId: 'g', hostUserId: 'h', edition: 'CIV6', gameType: 'FFA', draftMode: 'blind' },
    { ...OPTIONS, publicUrl: '' },
  );
  assert.equal(out, null);
});

test('buildLaunch makes the launcher the host', () => {
  const out = buildLaunch(
    { guildId: 'g', hostUserId: 'host-1', edition: 'CIV6', gameType: 'FFA', draftMode: 'blind' },
    OPTIONS,
  );
  assert.ok(out);
  assert.equal(out.record.config.hostId, 'host-1');
  assert.equal(out.record.phase, 'lobby');
});

test('the launch URL contains the session id and both tokens', () => {
  const out = buildLaunch(
    { guildId: 'g', hostUserId: 'host-1', edition: 'CIV6', gameType: 'FFA', draftMode: 'blind' },
    OPTIONS,
  );
  assert.ok(out);
  const url = new URL(out.result.url);
  assert.equal(url.origin, 'https://dev-activity.example.net');
  assert.equal(url.searchParams.get('session'), out.result.sessionId);
  assert.ok((url.searchParams.get('identity') ?? '').length > 0);
  assert.ok((url.searchParams.get('access') ?? '').length > 0);
});

test('the minted host tokens admit the host into the created lobby', () => {
  const out = buildLaunch(
    { guildId: 'g', hostUserId: 'host-1', edition: 'CIV6', gameType: 'FFA', draftMode: 'blind' },
    OPTIONS,
  );
  assert.ok(out);
  const url = new URL(out.result.url);
  const identityToken = url.searchParams.get('identity');
  const accessToken = url.searchParams.get('access');

  const admission = admitConnection({
    secret: SECRET,
    room: out.record, // fresh lobby, host not yet seated
    identityToken,
    roomAccessToken: accessToken,
  });
  assert.ok(admission.ok, 'host should be admitted');
  // Host hasn't JOINed yet, so they're admitted as a provisional lobby observer (Option A).
  assert.deepEqual(admission.recipient, { kind: 'observer', userId: 'host-1' });
});

test('a token minted for a different session does NOT admit', () => {
  const out = buildLaunch(
    { guildId: 'g', hostUserId: 'host-1', edition: 'CIV6', gameType: 'FFA', draftMode: 'blind' },
    OPTIONS,
  );
  const other = buildLaunch(
    { guildId: 'g', hostUserId: 'host-1', edition: 'CIV6', gameType: 'FFA', draftMode: 'blind' },
    OPTIONS,
  );
  assert.ok(out && other);
  const otherAccess = new URL(other.result.url).searchParams.get('access');
  const thisIdentity = new URL(out.result.url).searchParams.get('identity');

  const admission = admitConnection({
    secret: SECRET,
    room: out.record,
    identityToken: thisIdentity,
    roomAccessToken: otherAccess, // bound to a different session id
  });
  assert.ok(!admission.ok && admission.refusal.kind === 'forbidden');
});
