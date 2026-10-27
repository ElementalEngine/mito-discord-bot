import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { Lobby } from '../../api/types.js';
import { container, type Panel } from '../kit/index.js';
import { blindClosedPanel, blindPickPanel, blindStatusPanel, voteStatusPanel } from './lobby-vote.js';

const lobby = (fields: Partial<Lobby> = {}): Lobby => ({
  id: '652f1a2b3c4d5e6f7a8b9c0d',
  shape: 'ffa-8',
  mode: 'ffa',
  seats: 8,
  teams: 0,
  draft_mode: 'blind',
  status: 'open',
  phase: 'voting',
  deadline: '2026-10-27T12:10:00Z',
  code: 'K7Q2',
  host_id: '100',
  guild_id: '1',
  channel_id: '2',
  message_id: '3',
  steam_link: null,
  message: null,
  lfg: false,
  players: ['100', '200', '300'].map((discord_id) => ({ discord_id, team: null })),
  settings: [],
  bans: [{ token: 'LEADER_A', kind: 'leader', by: 'host' }],
  pools: [],
  picks: [],
  vote: { channel_id: '9', messages: {}, finished: ['200'] },
  cancel_reason: null,
  updated_at: '2026-10-27T12:00:00Z',
  ...fields,
});
const NAMES = new Map([['LEADER_A', 'Abe'], ['LEADER_B', '<:Bea:55> Bea'], ['LEADER_C', 'Cy']]);
const textOf = (panel: Panel): string => (panel.body ?? []).map((b) => ('text' in b ? b.text : '')).join('\n');
type Json = { custom_id: string; label?: string; options?: { label: string; value: string; default?: boolean; emoji?: { id: string; name: string } }[] };
const componentsOf = (panel: Panel): Json[] => (panel.actions ?? []).flatMap((r) => r.components.map((c) => c.toJSON() as Json));

test('the vote is one message: the optional bans, what a ban needs, the host bans, who has finished', () => {
  const panel = voteStatusPanel(lobby(), NAMES);
  assert.equal(panel.title, 'Bans vote: Civ6 FFA, 8 seats lobby');
  assert.match(panel.subtitle ?? '', /Closes <t:1793103000:R>/);
  const body = textOf(panel);
  assert.match(body, /\*\*Optional: extra leader bans\*\*\nReact to this message with the server's leader emojis/);
  assert.match(body, /A ban lands with 2 of the 3 players/);
  assert.match(body, /\*\*Banned by the host\*\*\nAbe/);
  assert.match(body, /⬜ <@100>\n✅ <@200>\n⬜ <@300>/);
  assert.deepEqual(componentsOf(panel).map((c) => [c.custom_id, c.label]), [['lobby:finished:652f1a2b3c4d5e6f7a8b9c0d', 'Finished']]);
  assert.doesNotMatch(textOf(voteStatusPanel(lobby({ bans: [] }), NAMES)), /Banned by the host/);
  container(panel);
});

test('the blind draft shows who has locked in and offers a pick here to anyone the DM missed', () => {
  const picking = lobby({ phase: 'picking', deadline: '2026-10-27T12:13:00Z', picks: [{ player_id: '200', leader: 'LEADER_C', by: 'player' }] });
  const status = blindStatusPanel(picking);
  assert.match(status.subtitle ?? '', /Closes <t:1793103180:R>, or once every player has locked in/);
  assert.match(textOf(status), /Your pool is in your DMs/);
  assert.match(textOf(status), /⬜ <@100>\n✅ <@200>/);
  assert.deepEqual(componentsOf(status).map((c) => [c.custom_id, c.label]), [['lobby:pick:652f1a2b3c4d5e6f7a8b9c0d', 'Pick here']]);
});

test('a player chooses from their own pool, then locks it in', () => {
  const pools = [
    { player_id: '100', team: null, leaders: ['LEADER_B', 'LEADER_C'] },
    { player_id: '200', team: null, leaders: ['LEADER_A'] },
  ];
  const picking = lobby({ phase: 'picking', deadline: '2026-10-27T12:13:00Z', pools });
  type Lock = Json & { disabled?: boolean };
  const fresh = componentsOf(blindPickPanel(picking, '100', NAMES)) as Lock[];
  assert.deepEqual(fresh[0]!.options!.map((o) => [o.label, o.default, o.emoji?.id]), [['Bea', false, '55'], ['Cy', false, undefined]]);
  assert.deepEqual([fresh[1]!.custom_id, fresh[1]!.label, fresh[1]!.disabled], ['lobby:lockin:652f1a2b3c4d5e6f7a8b9c0d', 'Lock in', true]);
  const chosen = componentsOf(blindPickPanel(picking, '100', NAMES, 'LEADER_C')) as Lock[];
  assert.equal(chosen[0]!.options!.find((o) => o.default)?.value, 'LEADER_C');
  assert.deepEqual([chosen[1]!.custom_id, chosen[1]!.label, chosen[1]!.disabled], ['lobby:lockin:652f1a2b3c4d5e6f7a8b9c0d:LEADER_C', 'Lock in Cy', false]);
  const locked = blindPickPanel({ ...picking, picks: [{ player_id: '100', leader: 'LEADER_C', by: 'player' }] }, '100', NAMES);
  assert.equal(locked.actions, undefined);
  assert.match(locked.subtitle ?? '', /Locked in: Cy/);
});

test('the DM closes with the pick, saying when it was an auto pick', () => {
  const done = lobby({ status: 'done', picks: [{ player_id: '100', leader: 'LEADER_B', by: 'auto' }] });
  assert.equal(blindClosedPanel(done, '100', NAMES).subtitle, 'Revealed. You play Bea, an auto pick.');
  assert.match(blindClosedPanel(lobby({ status: 'cancelled' }), '100', NAMES).subtitle ?? '', /cancelled/);
});
