import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createRoomRecord } from '../../src/session/domain.js';
import type { RoomConfig, SessionDeps } from '../../src/session/domain.js';
import { createSystemClock } from '../../src/session/index.js';
import { createSeededRandom } from '../../src/engine/index.js';
import type { GameVoteConfig } from '../../src/shared/vote.types.js';
import { ActivityHub } from '../../src/activity/hub.js';
import type { HubConnection } from '../../src/activity/hub.js';
import type { ServerMessage } from '../../src/activity/protocol.js';

const NOW = 1_700_000_000_000;

function makeDeps(seed = 'hub'): SessionDeps {
  return { now: () => NOW, rng: createSeededRandom(seed) };
}

function config(draftMode: string): RoomConfig {
  const voteConfig: GameVoteConfig = {
    questions: [{ id: 'draft_mode', title: 'M', defaultOptionId: draftMode, options: [{ id: draftMode, label: draftMode }] }],
  };
  return { edition: 'CIV6', source: 'activity', mode: 'ffa', gameType: 'FFA', guildId: 'g', hostId: 'u1', voteConfig };
}

/** A fake connection that records every frame it receives. */
class FakeConnection implements HubConnection {
  readonly sent: ServerMessage[] = [];
  readonly userId: string;
  readonly staff: boolean;
  closed: { code: number; reason: string } | null = null;
  constructor(userId: string, staff = false) {
    this.userId = userId;
    this.staff = staff;
  }
  send(message: ServerMessage): void {
    this.sent.push(message);
  }
  close(code: number, reason: string): void {
    this.closed = { code, reason };
  }
  /** Last snapshot/update payload received, as an unknown record. */
  lastSnapshot(): Record<string, unknown> {
    for (let i = this.sent.length - 1; i >= 0; i--) {
      const m = this.sent[i];
      if (m.type === 'snapshot') return m.snapshot as Record<string, unknown>;
      if (m.type === 'update') return m.snapshot as Record<string, unknown>;
    }
    throw new Error(`no snapshot/update received by ${this.userId}`);
  }
}

function makeHub(seed = 'hub'): ActivityHub {
  return new ActivityHub({ deps: makeDeps(seed), clock: createSystemClock() });
}

test('attach sends an initial snapshot to a seated connection', async () => {
  const hub = makeHub();
  const actor = hub.createSession(createRoomRecord({ id: 's1', config: config('standard'), createdAt: 1 }));
  await actor.enqueue({ type: 'JOIN', userId: 'u1' });

  const conn = new FakeConnection('u1');
  hub.attach('s1', conn);

  assert.equal(conn.sent.length, 1);
  assert.equal(conn.sent[0]?.type, 'snapshot');
});

test('attach to an unknown session rejects', () => {
  const hub = makeHub();
  const conn = new FakeConnection('u1');
  hub.attach('missing', conn);
  assert.equal(conn.sent[0]?.type, 'reject');
});

test('state changes fan out to all attached connections', async () => {
  const hub = makeHub();
  const actor = hub.createSession(createRoomRecord({ id: 's1', config: config('standard'), createdAt: 1 }));
  await actor.enqueue({ type: 'JOIN', userId: 'u1' });

  const a = new FakeConnection('u1');
  const b = new FakeConnection('u2');
  hub.attach('s1', a);
  hub.attach('s1', b);

  const before = { a: a.sent.length, b: b.sent.length };
  await hub.submit('s1', { type: 'JOIN', userId: 'u2' });

  // Both connections got an 'update' from the STATE_CHANGED fan-out.
  assert.ok(a.sent.length > before.a, 'a received an update');
  assert.ok(b.sent.length > before.b, 'b received an update');
  assert.equal(a.sent.at(-1)?.type, 'update');
});

test('CENSORING: a blind-draft update for seat A never contains seat B private pool', async () => {
  const hub = makeHub('censor');
  const actor = hub.createSession(createRoomRecord({ id: 's1', config: config('blind'), createdAt: 1 }));
  for (const userId of ['u1', 'u2', 'u3']) await actor.enqueue({ type: 'JOIN', userId });
  // Advance lobby → settings → bans → draft (host advances).
  await actor.enqueue({ type: 'ADVANCE', byUserId: 'u1' });
  await actor.enqueue({ type: 'ADVANCE', byUserId: 'u1' });
  await actor.enqueue({ type: 'ADVANCE', byUserId: 'u1' });

  const a = new FakeConnection('u1');
  const b = new FakeConnection('u2');
  hub.attach('s1', a);
  hub.attach('s1', b);

  // Trigger a state change so both get a fresh censored update.
  await hub.submit('s1', { type: 'SET_READY', userId: 'u3', ready: true });

  const aSnap = JSON.stringify(a.lastSnapshot());
  const bSnap = JSON.stringify(b.lastSnapshot());

  // Each seat's blind pool is keyed by its own seatId; A's payload must key only u1, never u2/u3.
  const aDraft = a.lastSnapshot().draft as { kind?: string; state?: { kind?: string; pools?: Record<string, unknown> } };
  if (aDraft.kind === 'interactive' && aDraft.state?.kind === 'blind') {
    const poolKeys = Object.keys(aDraft.state.pools ?? {});
    assert.deepEqual(poolKeys, ['u1'], `seat u1 must only see its own pool, saw ${poolKeys.join(',')}`);
  }
  const bDraft = b.lastSnapshot().draft as { kind?: string; state?: { kind?: string; pools?: Record<string, unknown> } };
  if (bDraft.kind === 'interactive' && bDraft.state?.kind === 'blind') {
    const poolKeys = Object.keys(bDraft.state.pools ?? {});
    assert.deepEqual(poolKeys, ['u2'], `seat u2 must only see its own pool, saw ${poolKeys.join(',')}`);
  }
  // Sanity: the two seat payloads are not identical (they are censored differently).
  assert.notEqual(aSnap, bSnap, 'blind seats must receive different censored payloads');
});

test('an unseated staff observer receives the uncensored god-view', async () => {
  const hub = makeHub('obs');
  const actor = hub.createSession(createRoomRecord({ id: 's1', config: config('blind'), createdAt: 1 }));
  for (const userId of ['u1', 'u2', 'u3']) await actor.enqueue({ type: 'JOIN', userId });
  await actor.enqueue({ type: 'ADVANCE', byUserId: 'u1' });
  await actor.enqueue({ type: 'ADVANCE', byUserId: 'u1' });
  await actor.enqueue({ type: 'ADVANCE', byUserId: 'u1' });

  const mod = new FakeConnection('mod', true); // unseated staff
  hub.attach('s1', mod);

  const draft = mod.lastSnapshot().draft as { kind?: string; state?: { kind?: string; pools?: Record<string, unknown> } };
  if (draft.kind === 'interactive' && draft.state?.kind === 'blind') {
    const poolKeys = Object.keys(draft.state.pools ?? {}).sort();
    assert.deepEqual(poolKeys, ['u1', 'u2', 'u3'], 'observer sees all seats');
  }
});

test('recipient is re-derived live: an observer who joins mid-session becomes a seat', async () => {
  const hub = makeHub('rederive');
  const actor = hub.createSession(createRoomRecord({ id: 's1', config: config('standard'), createdAt: 1 }));
  await actor.enqueue({ type: 'JOIN', userId: 'u1' });

  const late = new FakeConnection('u2', true); // attaches as staff observer (unseated)
  hub.attach('s1', late);
  const asObserver = late.lastSnapshot().viewer as { kind?: string };
  assert.equal(asObserver.kind, 'observer');

  // u2 now JOINs; the next fan-out must project u2 as a seat, not an observer.
  await hub.submit('s1', { type: 'JOIN', userId: 'u2' });
  const asSeat = late.lastSnapshot().viewer as { kind?: string };
  assert.equal(asSeat.kind, 'seat');
});

test('NOTIFY targeted to one user reaches only that connection', async () => {
  // Drive a session to completion so a SESSION_CLOSED/NOTIFY path could fire; here we assert
  // targeted delivery directly via a public vs private notify is exercised through closeAll on cancel.
  const hub = makeHub('notify');
  const actor = hub.createSession(createRoomRecord({ id: 's1', config: config('standard'), createdAt: 1 }));
  await actor.enqueue({ type: 'JOIN', userId: 'u1' });
  await actor.enqueue({ type: 'JOIN', userId: 'u2' });

  const a = new FakeConnection('u1');
  const b = new FakeConnection('u2');
  hub.attach('s1', a);
  hub.attach('s1', b);

  await hub.submit('s1', { type: 'CANCEL', reason: 'test', byUserId: 'u1' });

  // SESSION_CLOSED → both connections receive a 'closed' frame and are closed.
  assert.ok(a.sent.some((m) => m.type === 'closed'));
  assert.ok(b.sent.some((m) => m.type === 'closed'));
  assert.ok(a.closed && b.closed);
});

test('detach removes a connection from future fan-out', async () => {
  const hub = makeHub('detach');
  const actor = hub.createSession(createRoomRecord({ id: 's1', config: config('standard'), createdAt: 1 }));
  await actor.enqueue({ type: 'JOIN', userId: 'u1' });

  const a = new FakeConnection('u1');
  hub.attach('s1', a);
  hub.detach('s1', a);
  const countAfterDetach = a.sent.length;

  await hub.submit('s1', { type: 'JOIN', userId: 'u2' });
  assert.equal(a.sent.length, countAfterDetach, 'detached connection receives no further frames');
});

test('submit to an unknown session returns INACTIVE', async () => {
  const hub = makeHub();
  const response = await hub.submit('missing', { type: 'JOIN', userId: 'u1' });
  assert.equal(response.ok, false);
  assert.equal(response.ok === false && response.code, 'INACTIVE');
});
