import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createSessionActor, SessionActorDirectory } from '../../src/session/actor.js';
import type { EffectExecutor } from '../../src/session/actor.js';
import { createRoomRecord } from '../../src/session/domain.js';
import type { RoomConfig, SessionDeps, SessionEffect } from '../../src/session/domain.js';
import type { Clock } from '../../src/session/timers.js';
import { createSeededRandom } from '../../src/engine/random.js';

// ── Harness ─────────────────────────────────────────────────────────────────

const NOW = 1_000_000;
function makeDeps(seed = 'actor-test'): SessionDeps {
  return { now: () => NOW, rng: createSeededRandom(seed) };
}
function config(draftMode = 'standard'): RoomConfig {
  return {
    edition: 'CIV6',
    source: 'activity',
    mode: 'ffa',
    gameType: 'FFA',
    guildId: 'g',
    hostId: 'u1',
    voteConfig: { questions: [{ id: 'draft_mode', title: 'M', defaultOptionId: draftMode, options: [{ id: draftMode, label: draftMode }] }] },
  };
}

function fakeClock() {
  let time = NOW;
  let nextId = 1;
  const timers = new Map<number, { at: number; fire: () => void }>();
  const clock: Clock = {
    now: () => time,
    schedule: (atMs, fire) => {
      const id = nextId++;
      timers.set(id, { at: atMs, fire });
      return id;
    },
    cancel: (handle) => {
      timers.delete(handle as number);
    },
  };
  return {
    clock,
    advanceTo(t: number) {
      time = t;
      for (const [id, timer] of [...timers.entries()]) {
        if (timer.at <= time) {
          timers.delete(id);
          timer.fire();
        }
      }
    },
    pending: () => timers.size,
  };
}

/** Collecting executor; optionally async with a controllable delay to prove serialization. */
function collector(delayMs = 0) {
  const batches: Array<{ types: string[]; effects: readonly SessionEffect[] }> = [];
  const execute: EffectExecutor = async (effects) => {
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    batches.push({ types: effects.map((e) => e.type), effects });
  };
  return { batches, execute, allTypes: () => batches.flatMap((b) => b.types) };
}

// ── Tests ───────────────────────────────────────────────────────────────────

test('enqueue applies commands and resolves with the reducer response', async () => {
  const fc = fakeClock();
  const fx = collector();
  const actor = createSessionActor({ id: 'a1', initial: createRoomRecord({ id: 'a1', config: config(), createdAt: 1 }), deps: makeDeps(), clock: fc.clock, executeEffects: fx.execute });

  assert.deepEqual(await actor.enqueue({ type: 'JOIN', userId: 'u1' }), { ok: true });
  const dup = await actor.enqueue({ type: 'JOIN', userId: 'u1' });
  assert.equal(dup.ok, false);
  assert.equal(dup.ok === false && dup.code, 'ALREADY_MEMBER');
  assert.equal(actor.snapshot().version, 1);
  assert.deepEqual(fx.allTypes(), ['STATE_CHANGED']); // the reject forwarded nothing
});

test('concurrent enqueues serialize in order over the shared record (slow async executor)', async () => {
  const fc = fakeClock();
  const fx = collector(5); // slow executor — interleave would corrupt seat indices
  const actor = createSessionActor({ id: 'a2', initial: createRoomRecord({ id: 'a2', config: config(), createdAt: 1 }), deps: makeDeps(), clock: fc.clock, executeEffects: fx.execute });

  const results = await Promise.all([
    actor.enqueue({ type: 'JOIN', userId: 'u1' }),
    actor.enqueue({ type: 'JOIN', userId: 'u2' }),
    actor.enqueue({ type: 'JOIN', userId: 'u3' }),
  ]);
  assert.ok(results.every((r) => r.ok));
  const members = actor.snapshot().members;
  assert.deepEqual(
    Object.values(members).map((m) => [m.userId, m.seatIndex]),
    [['u1', 0], ['u2', 1], ['u3', 2]],
  );
  assert.equal(actor.snapshot().version, 3);
});

test('SET_DEADLINE is intercepted into the registry; firing enqueues TIMEOUT and advances the phase', async () => {
  const fc = fakeClock();
  const fx = collector();
  const actor = createSessionActor({ id: 'a3', initial: createRoomRecord({ id: 'a3', config: config(), createdAt: 1 }), deps: makeDeps(), clock: fc.clock, executeEffects: fx.execute });

  await actor.enqueue({ type: 'JOIN', userId: 'u1' });
  await actor.enqueue({ type: 'JOIN', userId: 'u2' });
  await actor.enqueue({ type: 'ADVANCE', byUserId: 'u1' }); // → settings, arms phase:settings
  assert.equal(actor.snapshot().phase, 'settings');
  assert.equal(fc.pending(), 1); // deadline armed on the clock, not forwarded
  assert.ok(!fx.allTypes().includes('SET_DEADLINE'));

  fc.advanceTo(actor.snapshot().deadline?.at ?? 0); // deadline fires → enqueue(TIMEOUT)
  await new Promise((resolve) => setImmediate(resolve)); // let the queued TIMEOUT run
  assert.equal(actor.snapshot().phase, 'bans'); // settings resolved by timeout
});

test('SESSION_CLOSED forwards to the executor, disarms, and disposes the actor', async () => {
  const fc = fakeClock();
  const fx = collector();
  const actor = createSessionActor({ id: 'a4', initial: createRoomRecord({ id: 'a4', config: config(), createdAt: 1 }), deps: makeDeps(), clock: fc.clock, executeEffects: fx.execute });

  await actor.enqueue({ type: 'JOIN', userId: 'u1' });
  await actor.enqueue({ type: 'JOIN', userId: 'u2' });
  await actor.enqueue({ type: 'ADVANCE', byUserId: 'u1' }); // settings (deadline armed)
  await actor.enqueue({ type: 'CANCEL', reason: 'host-abort', byUserId: 'u1' });

  assert.ok(fx.allTypes().includes('SESSION_CLOSED'));
  assert.equal(actor.isDisposed(), true);
  assert.equal(fc.pending(), 0); // deadline disarmed
  const late = await actor.enqueue({ type: 'JOIN', userId: 'u9' });
  assert.equal(late.ok, false);
  assert.equal(late.ok === false && late.code, 'INACTIVE');
});

test('a rejected executor does not wedge the queue; the caller sees the rejection', async () => {
  const fc = fakeClock();
  let boom = true;
  const execute: EffectExecutor = () => {
    if (boom) throw new Error('transport down');
  };
  const actor = createSessionActor({ id: 'a5', initial: createRoomRecord({ id: 'a5', config: config(), createdAt: 1 }), deps: makeDeps(), clock: fc.clock, executeEffects: execute });

  await assert.rejects(actor.enqueue({ type: 'JOIN', userId: 'u1' }), /transport down/);
  boom = false;
  assert.deepEqual(await actor.enqueue({ type: 'JOIN', userId: 'u2' }), { ok: true }); // queue alive
  assert.equal(actor.snapshot().members['u1']?.userId, 'u1'); // state applied despite executor failure
});

test('directory: create supersedes and disposes a stale actor under the same id', async () => {
  const fc = fakeClock();
  const fx = collector();
  const directory = new SessionActorDirectory();
  const deps = makeDeps();

  const first = directory.create({ id: 's1', initial: createRoomRecord({ id: 's1', config: config(), createdAt: 1 }), deps, clock: fc.clock, executeEffects: fx.execute });
  const second = directory.create({ id: 's1', initial: createRoomRecord({ id: 's1', config: config(), createdAt: 2 }), deps, clock: fc.clock, executeEffects: fx.execute });

  assert.equal(first.isDisposed(), true);
  assert.equal(second.isDisposed(), false);
  assert.equal(directory.get('s1'), second);
  assert.equal(directory.size(), 1);
});

test('directory: an actor removes itself when its session closes; disposeAll clears the rest', async () => {
  const fc = fakeClock();
  const fx = collector();
  const directory = new SessionActorDirectory();
  const deps = makeDeps();

  const a = directory.create({ id: 'sA', initial: createRoomRecord({ id: 'sA', config: config(), createdAt: 1 }), deps, clock: fc.clock, executeEffects: fx.execute });
  directory.create({ id: 'sB', initial: createRoomRecord({ id: 'sB', config: config(), createdAt: 1 }), deps, clock: fc.clock, executeEffects: fx.execute });
  assert.equal(directory.size(), 2);

  await a.enqueue({ type: 'JOIN', userId: 'u1' });
  await a.enqueue({ type: 'CANCEL', reason: 'done', byUserId: 'u1' }); // SESSION_CLOSED → self-remove
  assert.equal(directory.get('sA'), undefined);
  assert.equal(directory.size(), 1);

  directory.disposeAll();
  assert.equal(directory.size(), 0);
});

test('rehydration: an initial record with a pending deadline is re-armed and fires', async () => {
  const fc = fakeClock();
  const fx = collector();
  const initial = createRoomRecord({ id: 'a6', config: config(), createdAt: 1 });
  // simulate a persisted mid-settings room (as R5.4 will load it)
  initial.phase = 'settings';
  initial.members = { u1: { userId: 'u1', seatIndex: 0, ready: false }, u2: { userId: 'u2', seatIndex: 1, ready: false } };
  initial.deadline = { token: 'phase:settings', at: NOW + 1000 };

  const actor = createSessionActor({ id: 'a6', initial, deps: makeDeps(), clock: fc.clock, executeEffects: fx.execute });
  assert.equal(fc.pending(), 1); // adopted at construction
  fc.advanceTo(NOW + 1000);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(actor.snapshot().phase, 'bans'); // fired TIMEOUT resolved settings
});
