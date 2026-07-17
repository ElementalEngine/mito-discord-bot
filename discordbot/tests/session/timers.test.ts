import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createDeadlineRegistry, createSystemClock } from '../../src/session/timers.js';
import type { Clock } from '../../src/session/timers.js';

/** A controllable clock: `advanceTo(t)` fires every scheduled callback due at or before `t`. */
function fakeClock() {
  let time = 0;
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

test('arm fires exactly once, at the deadline, with the token; then clears', () => {
  const fc = fakeClock();
  const fired: string[] = [];
  const reg = createDeadlineRegistry({ clock: fc.clock, onFire: (t) => fired.push(t) });
  reg.arm('phase:settings', 100);
  assert.equal(reg.activeToken(), 'phase:settings');

  fc.advanceTo(50);
  assert.deepEqual(fired, []); // not yet due
  fc.advanceTo(100);
  assert.deepEqual(fired, ['phase:settings']);
  assert.equal(reg.activeToken(), null); // cleared after firing

  fc.advanceTo(500);
  assert.deepEqual(fired, ['phase:settings']); // exactly once
});

test('arm supersedes the prior deadline; only the latest fires', () => {
  const fc = fakeClock();
  const fired: string[] = [];
  const reg = createDeadlineRegistry({ clock: fc.clock, onFire: (t) => fired.push(t) });
  reg.arm('turn:1', 100);
  reg.arm('turn:2', 200); // supersedes turn:1
  assert.equal(reg.activeToken(), 'turn:2');
  assert.equal(fc.pending(), 1); // the prior timer was cancelled
  fc.advanceTo(300);
  assert.deepEqual(fired, ['turn:2']);
});

test('disarm cancels the pending deadline', () => {
  const fc = fakeClock();
  const fired: string[] = [];
  const reg = createDeadlineRegistry({ clock: fc.clock, onFire: (t) => fired.push(t) });
  reg.arm('phase:bans', 100);
  reg.disarm();
  assert.equal(reg.activeToken(), null);
  assert.equal(fc.pending(), 0);
  fc.advanceTo(200);
  assert.deepEqual(fired, []);
});

test('rehydrate reconstructs a pending deadline; rehydrate(null) clears', () => {
  const fc = fakeClock();
  const fired: string[] = [];
  const reg = createDeadlineRegistry({ clock: fc.clock, onFire: (t) => fired.push(t) });
  reg.rehydrate({ token: 'phase:session', at: 150 });
  assert.equal(reg.activeToken(), 'phase:session');
  reg.rehydrate(null);
  assert.equal(reg.activeToken(), null);
  fc.advanceTo(150);
  assert.deepEqual(fired, []);

  reg.rehydrate({ token: 'phase:captains', at: 300 });
  fc.advanceTo(300);
  assert.deepEqual(fired, ['phase:captains']);
});

test('a superseded callback is a no-op even if the timer leaks past cancel', () => {
  // cancel is a no-op → simulates a real-clock race where an elapsed timer already queued its callback.
  const fires: Array<() => void> = [];
  const clock: Clock = {
    now: () => 0,
    schedule: (_atMs, fire) => {
      fires.push(fire);
      return fires.length;
    },
    cancel: () => {
      /* intentionally does not stop the timer */
    },
  };
  const fired: string[] = [];
  const reg = createDeadlineRegistry({ clock, onFire: (t) => fired.push(t) });
  reg.arm('A', 100);
  reg.arm('B', 200); // supersedes A; A's callback is still live because cancel is a no-op
  fires[0](); // A's stale callback → must not fire
  fires[1](); // B's callback → fires
  assert.deepEqual(fired, ['B']);
});

test('onFire may re-arm during the callback (draft turn → next turn)', () => {
  const fc = fakeClock();
  const fired: string[] = [];
  const reg = createDeadlineRegistry({
    clock: fc.clock,
    onFire: (t) => {
      fired.push(t);
      if (t === 'turn:1') reg.arm('turn:2', 300);
    },
  });
  reg.arm('turn:1', 100);
  fc.advanceTo(100); // fires turn:1, whose handler re-arms turn:2
  assert.equal(reg.activeToken(), 'turn:2');
  fc.advanceTo(300);
  assert.deepEqual(fired, ['turn:1', 'turn:2']);
});

test('createSystemClock schedules and cancels real timers', async () => {
  const clock = createSystemClock();
  assert.equal(typeof clock.now(), 'number');

  let firedCancelled = false;
  const handle = clock.schedule(clock.now() + 10, () => {
    firedCancelled = true;
  });
  clock.cancel(handle);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(firedCancelled, false); // cancelled before it could fire

  await new Promise<void>((resolve) => {
    clock.schedule(clock.now(), () => resolve());
  }); // a non-cancelled timer fires
});
