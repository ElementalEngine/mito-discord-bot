import assert from 'node:assert/strict';
import { test } from 'node:test';

import { eventsVisibleToSeat, publicEvent, seatEvent } from '../../src/engine/events.js';
import type { DraftEngineEvent } from '../../src/engine/events.js';

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
