import assert from 'node:assert/strict';
import { test } from 'node:test';

import { eventsVisibleToSeat, publicEvent, seatEvent } from '../../src/engine/events.js';
import type { DraftEngineEvent } from '../../src/engine/events.js';
import { DraftError, inputError, isDraftInputError } from '../../src/engine/drafts/errors.js';

test('publicEvent / seatEvent: visibility markers', () => {
  const pub = publicEvent('ROUND_ADVANCED', { round: 'leader' });
  assert.equal(pub.visibility, 'public');
  assert.equal(pub.type, 'ROUND_ADVANCED');

  const priv = seatEvent('STAGE_UPDATED', 'u1', { seatId: 'u1', staged: { leaderKey: 'L' } });
  assert.deepEqual(priv.visibility, { seatId: 'u1' });
});

test('eventsVisibleToSeat: censoring filter (public + own seat only)', () => {
  const events: DraftEngineEvent[] = [
    publicEvent('ROUND_ADVANCED', { round: 'leader' }),
    seatEvent('STAGE_UPDATED', 'u1', { seatId: 'u1', staged: { leaderKey: 'A' } }),
    seatEvent('STAGE_UPDATED', 'u2', { seatId: 'u2', staged: { leaderKey: 'B' } }),
  ];
  const forU1 = eventsVisibleToSeat(events, 'u1');
  assert.equal(forU1.length, 2);
  assert.ok(forU1.every((event) => event.visibility === 'public' || event.visibility.seatId === 'u1'));
  const forU3 = eventsVisibleToSeat(events, 'u3');
  assert.equal(forU3.length, 1);
});

test('DraftError: code + name preserved (legacy parity shape)', () => {
  const err = new DraftError('NO_POOL', 'nope');
  assert.equal(err.code, 'NO_POOL');
  assert.equal(err.name, 'DraftError');
  assert.equal(err.message, 'nope');
  assert.ok(err instanceof Error);
});

test('inputError / isDraftInputError', () => {
  const err = inputError('STALE', 'stale');
  assert.deepEqual(err, { error: { code: 'STALE', message: 'stale' } });
  assert.equal(isDraftInputError(err), true);
  assert.equal(isDraftInputError(null), false);
  assert.equal(isDraftInputError('x'), false);
  assert.equal(isDraftInputError({ state: {} }), false);
});
