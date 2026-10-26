import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { CivDataResponse, Lobby, SettingQuestion } from '../../api/types.js';
import { container, type Panel } from '../kit/index.js';
import {
  NOT_FIXED,
  lobbyBanForm,
  lobbyDraftPanels,
  lobbyLinkOf,
  lobbyPanel,
  openLobbiesPanel,
  settingsAfter,
  settingsPanel,
  teamsPanel,
} from './lobby.js';

const LINK = 'steam://joinlobby/289070/109775241000000000/76561198000000000';
const REDIRECT = 'https://dev-lobbylink.elementalengine.net';

const lobby = (fields: Partial<Lobby> = {}): Lobby => ({
  id: '652f1a2b3c4d5e6f7a8b9c0d',
  shape: 'ffa-8',
  mode: 'ffa',
  seats: 8,
  teams: 0,
  draft_mode: 'standard',
  status: 'open',
  host_id: '100',
  guild_id: '1',
  channel_id: '2',
  message_id: '3',
  steam_link: LINK,
  rules: null,
  players: [
    { discord_id: '100', team: null },
    { discord_id: '200', team: null },
  ],
  settings: [],
  bans: [],
  pools: [],
  cancel_reason: null,
  updated_at: '2026-10-26T12:00:00Z',
  ...fields,
});

const teamer = (players: [string, number][]): Lobby =>
  lobby({ shape: 'teamer-2v2', mode: 'teamer', seats: 4, teams: 2, players: players.map(([discord_id, team]) => ({ discord_id, team })) });

const QUESTIONS: SettingQuestion[] = [
  { id: 'huts', title: 'Huts', default_option_id: 'x1', options: [{ id: 'x1', label: '1x', emoji: '1️⃣' }, { id: 'x1_5', label: '1.5x', emoji: '2️⃣' }] },
  { id: 'map', title: 'Map', default_option_id: 'pangea', options: [{ id: 'pangea', label: 'Pangaea', emoji: '🌐' }] },
];

const view = (l: Lobby) => ({ lobby: l, names: new Map<string, string>(), questions: QUESTIONS, link: lobbyLinkOf(l.steam_link, REDIRECT) });
const textOf = (panel: Panel): string => (panel.body ?? []).map((b) => ('text' in b ? b.text : '')).join('\n');
const idsOf = (panel: Panel): string[] =>
  (panel.actions ?? []).flatMap((row) => row.components.map((c) => (c.toJSON() as { custom_id: string }).custom_id));

test('a Civ6 lobby link goes out through the redirect; anything else is refused', () => {
  assert.equal(lobbyLinkOf(` ${LINK} `, REDIRECT), `${REDIRECT}/civ6/109775241000000000/76561198000000000`);
  assert.equal(lobbyLinkOf('steam://joinlobby/1295660/109775241000000000/76561198000000000', REDIRECT), null);
  assert.equal(lobbyLinkOf('https://evil.example', REDIRECT), null);
});

test('an open lobby shows its link, seats, settings and bans, with every button but Teams', () => {
  const panel = lobbyPanel(view(lobby({ rules: 'No early war', settings: [{ id: 'huts', value: 'x1_5', by: 'host' }] })));
  assert.equal(panel.title, 'Civ6 FFA, 8 seats lobby');
  assert.equal(panel.subtitle, '2/8 seats · Standard draft');
  const body = textOf(panel);
  assert.match(body, /\[Join the Steam lobby\]\(https:\/\/dev-lobbylink\.elementalengine\.net\/civ6\//);
  assert.match(body, /1\. <@100> \(host\)\n2\. <@200>/);
  assert.match(body, /No early war/);
  assert.match(body, /Huts: 1\.5x/);
  assert.match(body, /\*\*Leader bans\*\*\nNone/);
  assert.deepEqual(
    idsOf(panel).map((id) => id.split(':')[1]),
    ['join', 'leave', 'start', 'settings', 'bans', 'cancel'],
  );
});

test('a teamer lists its teams and offers Teams', () => {
  const panel = lobbyPanel(view(teamer([['100', 1], ['200', 2], ['300', 1]])));
  assert.match(textOf(panel), /\*\*Team 1\*\* · <@100> \(host\), <@300>\n\*\*Team 2\*\* · <@200>/);
  assert.ok(idsOf(panel).some((id) => id.startsWith('lobby:teams:')));
});

test('a drafted lobby keeps its link and loses its buttons; a cancelled one says why', () => {
  const drafted = lobbyPanel(view(lobby({ status: 'done' })));
  assert.equal(drafted.title, 'Civ6 FFA, 8 seats lobby: drafted');
  assert.equal(drafted.actions, undefined);
  assert.match(textOf(drafted), /Join the Steam lobby/);
  const closed = lobbyPanel(view(lobby({ status: 'cancelled', cancel_reason: 'idle' })));
  assert.equal(closed.subtitle, 'Closed after 2.5 hours with no activity');
  assert.equal(closed.actions, undefined);
  assert.equal(textOf(closed), '');
});

test('each draft is its own message, named for its player or its team', () => {
  const names = new Map([['LEADER_A', 'Abe'], ['LEADER_B', 'Bea']]);
  const ffa = lobbyDraftPanels(lobby({ pools: [{ player_id: '100', team: null, leaders: ['LEADER_A', 'LEADER_B'] }] }), names);
  assert.equal(ffa[0]!.title, '<@100>');
  assert.equal(textOf(ffa[0]!), 'Abe\nBea');
  const team = lobbyDraftPanels({ ...teamer([['100', 1], ['200', 2], ['300', 1]]), pools: [{ player_id: null, team: 1, leaders: ['LEADER_A'] }] }, names);
  assert.equal(team[0]!.title, 'Team 1');
  assert.equal(textOf(team[0]!), '-# <@100>, <@300>\nAbe');
});

test('the host fixes or frees each setting from its own menu', () => {
  const fixed = lobby({ settings: [{ id: 'huts', value: 'x1_5', by: 'host' }] });
  const menus = settingsPanel(fixed, QUESTIONS).actions!.map((row) => row.components[0]!.toJSON() as { custom_id: string; options: { value: string; default?: boolean }[] });
  assert.deepEqual(menus.map((m) => m.custom_id.split(':').slice(1)), [['setting', fixed.id, 'huts'], ['setting', fixed.id, 'map']]);
  assert.equal(menus[0]!.options.find((o) => o.default)?.value, 'x1_5');
  assert.equal(menus[1]!.options.find((o) => o.default)?.value, NOT_FIXED);
  assert.deepEqual(settingsAfter(fixed, 'map', 'pangea'), { huts: 'x1_5', map: 'pangea' });
  assert.deepEqual(settingsAfter(fixed, 'huts', NOT_FIXED), {});
});

test('team moves offer only teams with room', () => {
  const full = teamer([['100', 1], ['200', 2], ['300', 1], ['400', 2]]);
  assert.match(textOf(teamsPanel(full, new Map())), /every other team is full/);
  const open = teamer([['100', 1], ['200', 2], ['300', 1]]);
  const menu = teamsPanel(open, new Map([['100', 'Host']])).actions![0]!.components[0]!.toJSON() as { options: { label: string; value: string }[] };
  assert.deepEqual(menu.options.map((o) => o.value), ['100:2', '300:2']);
  assert.equal(menu.options[0]!.label, 'Host to Team 2');
});

test('browse links each open lobby to its post', () => {
  assert.match(textOf(openLobbiesPanel([lobby()])), /\*\*FFA, 8 seats\*\* · 2\/8 · hosted by <@100> · \[open\]\(https:\/\/discord\.com\/channels\/1\/2\/3\)/);
  assert.match(textOf(openLobbiesPanel([])), /No lobby is open here/);
});

test('every lobby panel fits Discord, and the ban form ticks what is banned', () => {
  const fourteen = lobby({ shape: 'ffa-14', seats: 14, players: Array.from({ length: 14 }, (_, i) => ({ discord_id: String(100 + i), team: null })) });
  const nine: SettingQuestion[] = Array.from({ length: 9 }, (_, i) => ({ ...QUESTIONS[0]!, id: `q${i}` }));
  for (const panel of [lobbyPanel(view(fourteen)), settingsPanel(fourteen, nine), teamsPanel(teamer([['100', 1]]), new Map())]) container(panel);
  const rows = { leaders: Array.from({ length: 89 }, (_, i) => ({ token: `LEADER_${i}`, name: `L${i}`, display: `Leader ${i}` })), civs: [] } as unknown as CivDataResponse;
  const form = lobbyBanForm(lobby({ bans: [{ token: 'LEADER_3', kind: 'leader', by: 'host' }] }), rows, new Map()).toJSON();
  assert.equal(form.components.length, 4);
  const ticked = form.components.flatMap((c) => (c as unknown as { component: { options: { value: string; default?: boolean }[] } }).component.options.filter((o) => o.default).map((o) => o.value));
  assert.deepEqual(ticked, ['LEADER_3']);
});
