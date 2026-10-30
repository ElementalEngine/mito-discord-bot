import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { Vote } from '../../api/types.js';
import { container, type Panel } from '../kit/index.js';
import { voteBlindPickPanel } from './vote.js';

const vote = (fields: Partial<Vote> = {}): Vote => ({
  id: '652f1a2b3c4d5e6f7a8b9c0d',
  edition: 'civ7',
  mode: 'ffa',
  teams: 0,
  age: null,
  draft_mode: 'blind',
  status: 'open',
  phase: 'picking',
  deadline: '2026-10-27T12:10:00Z',
  code: 'K7Q2DM',
  host_id: '100',
  guild_id: '1',
  channel_id: '2',
  players: ['100', '200', '300'].map((discord_id) => ({ discord_id, team: null })),
  settings: [],
  bans: [],
  pools: [{ player_id: '100', team: null, leaders: ['LEADER_A'], civs: ['CIV_X'] }],
  picks: [],
  vote: { channel_id: '9', messages: {}, finished: [] },
  cancel_reason: null,
  updated_at: '2026-10-27T12:00:00Z',
  ...fields,
});
type Json = { custom_id: string; label?: string };
const buttonsOf = (panel: Panel): Json[] => (panel.actions ?? []).flatMap((r) => r.components.map((c) => c.toJSON() as Json));

test('the lock-in button names the picks within the 80 characters Discord allows', () => {
  const long = 'W'.repeat(40);
  const names = new Map([
    ['LEADER_A', long],
    ['CIV_X', long],
  ]);
  const panel = voteBlindPickPanel(vote(), '100', names, 'LEADER_A', 'CIV_X');
  const lockIn = buttonsOf(panel).find((b) => b.custom_id.includes(':lockin:'));
  assert.ok(lockIn?.label?.startsWith('Lock in WWWW'));
  assert.ok((lockIn?.label?.length ?? 99) <= 80);
  container(panel);
});
