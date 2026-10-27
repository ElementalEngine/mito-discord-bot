import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { Lobby, SettingQuestion } from '../../api/types.js';
import { container, type Panel } from '../kit/index.js';
import { openQuestions, voteBansPanel, voteCountedPanel, voteQuestionPanel, voteStatusPanel } from './lobby-vote.js';

const VOTE = { ends_at: '2026-10-27T12:10:00Z', channel_id: '9', messages: {}, finished: ['200'] };
const lobby = (fields: Partial<Lobby> = {}): Lobby => ({
  id: '652f1a2b3c4d5e6f7a8b9c0d',
  shape: 'ffa-8',
  mode: 'ffa',
  seats: 8,
  teams: 0,
  draft_mode: 'standard',
  status: 'open',
  live: true,
  host_id: '100',
  guild_id: '1',
  channel_id: '2',
  message_id: '3',
  steam_link: null,
  players: ['100', '200', '300'].map((discord_id) => ({ discord_id, team: null })),
  settings: [{ id: 'huts', value: 'x1', by: 'host' }],
  bans: [{ token: 'LEADER_A', kind: 'leader', by: 'host' }],
  pools: [],
  vote: VOTE,
  cancel_reason: null,
  updated_at: '2026-10-27T12:00:00Z',
  ...fields,
});
const QUESTIONS: SettingQuestion[] = [
  { id: 'huts', title: 'Huts', default_option_id: 'x1', options: [{ id: 'x1', label: '1x', emoji: '1️⃣' }] },
  { id: 'map', title: 'Map', default_option_id: 'pangea', options: [{ id: 'pangea', label: 'Pangaea', emoji: '🌐' }, { id: 'lakes', label: 'Lakes', emoji: '🌊' }] },
];
const textOf = (panel: Panel): string => (panel.body ?? []).map((b) => ('text' in b ? b.text : '')).join('\n');

test('only the settings the host left open are voted', () => {
  assert.deepEqual(openQuestions(lobby(), QUESTIONS).map((q) => q.id), ['map']);
});

test('the status shows who has finished, when it closes, and the Finished button', () => {
  const panel = voteStatusPanel(lobby(), VOTE);
  assert.equal(panel.title, 'Vote: Civ6 FFA, 8 seats lobby');
  assert.match(panel.subtitle ?? '', /Closes <t:1793103000:R>/);
  assert.match(textOf(panel), /⬜ <@100>\n✅ <@200>\n⬜ <@300>/);
  const [button] = (panel.actions ?? []).flatMap((r) => r.components.map((c) => c.toJSON() as { custom_id: string; label: string }));
  assert.deepEqual([button?.custom_id, button?.label], ['lobby:finished:652f1a2b3c4d5e6f7a8b9c0d', 'Finished']);
  container(panel);
});

test('each setting lists its options by emoji, and the bans say what a ban needs', () => {
  assert.equal(textOf(voteQuestionPanel(QUESTIONS[1]!)), '🌐 Pangaea\n🌊 Lakes');
  const bans = textOf(voteBansPanel(lobby(), new Map([['LEADER_A', 'Abe']])));
  assert.match(bans, /A ban lands with 2 of the 3 players/);
  assert.match(bans, /\*\*Banned by the host\*\*\nAbe/);
  assert.doesNotMatch(textOf(voteBansPanel(lobby({ bans: [] }), new Map())), /Banned by the host/);
});

test('a closed vote says where the result went', () => {
  assert.match(voteCountedPanel(lobby({ status: 'done' })).subtitle ?? '', /draft is on the lobby post/);
  assert.match(voteCountedPanel(lobby({ status: 'cancelled' })).subtitle ?? '', /cancelled/);
});
