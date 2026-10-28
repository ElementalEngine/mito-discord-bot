import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { SettingQuestion, Vote } from '../../api/types.js';
import { container, type Panel } from '../kit/index.js';
import { questionPanel, voteBansPanel, voteBlindPickPanel, voteBlindStatusPanel, voteDraftPanels, voteStatusPanel } from './vote.js';

const vote = (fields: Partial<Vote> = {}): Vote => ({
  id: '652f1a2b3c4d5e6f7a8b9c0d',
  edition: 'civ6',
  mode: 'ffa',
  teams: 0,
  age: null,
  draft_mode: null,
  status: 'open',
  phase: 'voting',
  deadline: '2026-10-27T12:10:00Z',
  code: 'K7Q2DM',
  host_id: '100',
  guild_id: '1',
  channel_id: '2',
  players: ['100', '200', '300'].map((discord_id) => ({ discord_id, team: null })),
  settings: [],
  bans: [],
  pools: [],
  picks: [],
  vote: { channel_id: '9', messages: {}, finished: ['200'] },
  cancel_reason: null,
  updated_at: '2026-10-27T12:00:00Z',
  ...fields,
});
const NAMES = new Map([
  ['LEADER_A', 'Abe'],
  ['LEADER_B', '<:Bea:55> Bea'],
  ['CIV_X', 'Xia'],
  ['CIV_Y', 'Yor'],
]);
const FOOTER = 'Started by <@100> · code K7Q2DM';
const HUTS: SettingQuestion = { id: 'huts', title: 'Goody Huts', default_option_id: 'x1', options: [{ id: 'x1', label: '1x', emoji: '1️⃣' }, { id: 'x2', label: '2x', emoji: '2️⃣' }] };
const textOf = (panel: Panel): string => (panel.body ?? []).map((b) => ('text' in b ? b.text : '')).join('\n');
type Json = { custom_id: string; label?: string; disabled?: boolean; options?: { value: string; default?: boolean }[] };
const componentsOf = (panel: Panel): Json[] => (panel.actions ?? []).flatMap((r) => r.components.map((c) => c.toJSON() as Json));

test('the vote opens with what to do, who has finished, Finished, and its starter and code', () => {
  const panel = voteStatusPanel(vote());
  assert.equal(panel.title, 'Vote: Civ6 FFA');
  assert.match(panel.subtitle ?? '', /Closes <t:1793103000:R>, or once every player has finished/);
  assert.match(textOf(panel), /### React on each setting below\n.*An option backed by 2 of the 3 players wins at once; the rest go to the most reactions once all finish, a tie settled at random/);
  assert.match(textOf(panel), /⬜ <@100>\n✅ <@200>\n⬜ <@300>/);
  assert.deepEqual(componentsOf(panel).map((c) => [c.custom_id, c.label]), [['vote:finished:652f1a2b3c4d5e6f7a8b9c0d', 'Finished']]);
  assert.equal(panel.footer, FOOTER);
  assert.equal(voteStatusPanel(vote({ edition: 'civ7', mode: 'teamer', teams: 2, age: 'AGE_MODERN' })).title, 'Vote: Civ7 Teamer · Modern');
  container(panel);
});

test('each setting is its own message, its options by the emoji to react with, and shows the one a majority won', () => {
  const panel = questionPanel(HUTS);
  assert.deepEqual([panel.title, panel.tone, panel.subtitle], ['Goody Huts', 'info', undefined]);
  assert.equal(textOf(panel), '1️⃣ 1x\n2️⃣ 2x');
  const won = questionPanel(HUTS, 'x2');
  assert.deepEqual([won.tone, won.subtitle], ['success', 'Won: 2x']);
  assert.equal(textOf(won), '1️⃣ 1x\n✅ **2️⃣ 2x**');
});

test('a bans message says what a ban needs and shows the bans so far, before and during the vote', () => {
  const bans = [
    { token: 'LEADER_A', kind: 'leader', by: 'host' },
    { token: 'LEADER_B', kind: 'leader', by: 'vote' },
    { token: 'CIV_X', kind: 'civ', by: 'vote' },
  ];
  const leaders = textOf(voteBansPanel(vote({ bans }), 'leader', NAMES));
  assert.match(leaders, /server's leader emojis to ban them\. A leader is banned once 2 of the 3 players react, and stays banned/);
  assert.match(leaders, /\*\*Banned by the vote\*\*\n<:Bea:55> Bea\n\*\*Banned before the vote\*\*\nAbe/);
  const civs = voteBansPanel(vote({ bans }), 'civ', NAMES);
  assert.equal(civs.title, 'Civ bans');
  assert.match(textOf(civs), /\*\*Banned by the vote\*\*\nXia$/);
});

test('a civ7 blind pick takes a leader and a civ, each menu keeping the other, then locks in both', () => {
  const pools = [{ player_id: '100', team: null, leaders: ['LEADER_A', 'LEADER_B'], civs: ['CIV_X', 'CIV_Y'] }];
  const picking = vote({ edition: 'civ7', phase: 'picking', pools });
  const fresh = componentsOf(voteBlindPickPanel(picking, '100', NAMES));
  assert.deepEqual(fresh.map((c) => c.custom_id), ['vote:leader:652f1a2b3c4d5e6f7a8b9c0d', 'vote:civ:652f1a2b3c4d5e6f7a8b9c0d', 'vote:lockin:652f1a2b3c4d5e6f7a8b9c0d']);
  assert.equal(fresh[2]!.disabled, true);
  const half = componentsOf(voteBlindPickPanel(picking, '100', NAMES, 'LEADER_B'));
  assert.equal(half[1]!.custom_id, 'vote:civ:652f1a2b3c4d5e6f7a8b9c0d:LEADER_B');
  assert.equal(half[2]!.disabled, true);
  const both = componentsOf(voteBlindPickPanel(picking, '100', NAMES, 'LEADER_B', 'CIV_Y'));
  assert.equal(both[0]!.custom_id, 'vote:leader:652f1a2b3c4d5e6f7a8b9c0d:CIV_Y');
  assert.deepEqual([both[2]!.custom_id, both[2]!.label, both[2]!.disabled], ['vote:lockin:652f1a2b3c4d5e6f7a8b9c0d:LEADER_B:CIV_Y', 'Lock in Bea · Yor', false]);
  const locked = voteBlindPickPanel({ ...picking, picks: [{ player_id: '100', leader: 'LEADER_B', civ: 'CIV_Y', by: 'player' }] }, '100', NAMES);
  assert.match(locked.subtitle ?? '', /Locked in: Bea · Yor/);
  assert.match(textOf(voteBlindStatusPanel(picking)), /lock in a leader and a civ/);
});

test("a vote's draft is posted as every draft is, with civ7's civs", () => {
  const pools = [
    { player_id: '100', team: null, leaders: ['LEADER_A'], civs: ['CIV_X', 'CIV_Y'] },
    { player_id: '200', team: null, leaders: ['LEADER_B'], civs: ['CIV_Y', 'CIV_X'] },
  ];
  const settings = [{ id: 'huts', value: 'x2', by: 'vote' }];
  const standard = voteDraftPanels(vote({ edition: 'civ7', status: 'done', draft_mode: 'standard', pools, settings }), NAMES, [HUTS]);
  assert.equal(standard[0]!.title, 'Civ7 FFA draft');
  assert.equal(standard[0]!.subtitle, 'Standard draft · 1 leader and 2 civs each');
  assert.match(textOf(standard[0]!), /2️⃣ Goody Huts: 2x\n\*\*Leader bans\*\*\nNone\n\*\*Civ bans\*\*\nNone/);
  assert.equal(textOf(standard[1]!), 'Abe\n-# Civs\nXia\nYor');
  assert.deepEqual(standard.map((p) => p.footer), [FOOTER, FOOTER, FOOTER]);
  const picks = [{ player_id: '100', leader: 'LEADER_A', civ: 'CIV_X', by: 'auto' as const }];
  const blind = voteDraftPanels(vote({ edition: 'civ7', status: 'done', draft_mode: 'blind', picks }), NAMES, [HUTS]);
  assert.match(textOf(blind[0]!), /^\*\*Picks\*\*\n<@100> · Abe · Xia \(auto pick\)/);
});
