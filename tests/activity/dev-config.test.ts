import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildDevConfig,
  normalizeEdition,
  normalizeGameType,
  normalizeDraftMode,
} from '../../src/activity/dev-config.js';
import { createRoomRecord } from '../../src/session/domain.js';
import type { SessionDeps } from '../../src/session/domain.js';
import { createSystemClock } from '../../src/session/index.js';
import { createSeededRandom } from '../../src/engine/index.js';
import { ActivityHub } from '../../src/activity/hub.js';
import type { HubConnection } from '../../src/activity/hub.js';
import type { ServerMessage } from '../../src/activity/protocol.js';

test('normalizeEdition defaults to CIV6 and accepts CIV7', () => {
  assert.equal(normalizeEdition('CIV7'), 'CIV7');
  assert.equal(normalizeEdition('CIV6'), 'CIV6');
  assert.equal(normalizeEdition('garbage'), 'CIV6');
  assert.equal(normalizeEdition(undefined), 'CIV6');
});

test('normalizeGameType defaults to FFA and accepts Teamer/Duel', () => {
  assert.equal(normalizeGameType('Teamer'), 'Teamer');
  assert.equal(normalizeGameType('Duel'), 'Duel');
  assert.equal(normalizeGameType('FFA'), 'FFA');
  assert.equal(normalizeGameType('x'), 'FFA');
});

test('normalizeDraftMode defaults to standard and accepts the four modes', () => {
  for (const mode of ['standard', 'snake', 'blind', 'cwc']) {
    assert.equal(normalizeDraftMode(mode), mode);
  }
  assert.equal(normalizeDraftMode('random'), 'standard'); // removed mode (D14)
  assert.equal(normalizeDraftMode(42), 'standard');
});

test('buildDevConfig produces a valid FFA config with a draft_mode question', () => {
  const cfg = buildDevConfig({ edition: 'CIV6', gameType: 'FFA', draftMode: 'blind', hostId: 'h' });
  assert.equal(cfg.edition, 'CIV6');
  assert.equal(cfg.gameType, 'FFA');
  assert.equal(cfg.source, 'activity');
  assert.equal(cfg.voteConfig.questions[0]?.id, 'draft_mode');
  assert.equal(cfg.voteConfig.questions[0]?.defaultOptionId, 'blind');
  assert.equal(cfg.numberTeams, undefined);
});

test('buildDevConfig sets numberTeams for Teamer', () => {
  const cfg = buildDevConfig({ edition: 'CIV7', gameType: 'Teamer', draftMode: 'cwc', hostId: 'h' });
  assert.equal(cfg.numberTeams, 2);
});

// ── Contract: a dev session is actually joinable and reaches the draft phase ──

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
  lastPhase(): string {
    for (let i = this.sent.length - 1; i >= 0; i--) {
      const m = this.sent[i];
      if (m.type === 'snapshot' || m.type === 'update') {
        return (m.snapshot as { phase?: string }).phase ?? 'unknown';
      }
    }
    throw new Error('no snapshot');
  }
}

test('a dev-config standard session drives lobby → draft through the hub', async () => {
  const deps: SessionDeps = { now: () => 1_700_000_000_000, rng: createSeededRandom('dev') };
  const hub = new ActivityHub({ deps, clock: createSystemClock() });
  const cfg = buildDevConfig({ edition: 'CIV6', gameType: 'FFA', draftMode: 'standard', hostId: 'u1' });
  const actor = hub.createSession(createRoomRecord({ id: 'dev-s1', config: cfg, createdAt: 1 }));

  for (const userId of ['u1', 'u2']) await actor.enqueue({ type: 'JOIN', userId });

  const conn = new FakeConnection('u1');
  hub.attach('dev-s1', conn);
  assert.equal(conn.lastPhase(), 'lobby');

  // Host advances lobby → settings → bans → draft.
  await hub.submit('dev-s1', { type: 'ADVANCE', byUserId: 'u1' });
  await hub.submit('dev-s1', { type: 'ADVANCE', byUserId: 'u1' });
  await hub.submit('dev-s1', { type: 'ADVANCE', byUserId: 'u1' });

  const phase = conn.lastPhase();
  assert.ok(phase === 'draft' || phase === 'complete', `expected draft/complete, got ${phase}`);
});
