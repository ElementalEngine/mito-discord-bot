import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { CivDataResponse, Lobby, SettingQuestion } from '../../api/types.js';
import { container, type Panel } from '../kit/index.js';
import {
  NOT_FIXED,
  draftOf,
  editOf,
  editorPanel,
  lobbyBanForm,
  lobbyDraftPanels,
  lobbyLinkOf,
  lobbyPanel,
  openLobbiesPanel,
  withBans,
  withKick,
  withMove,
  withSetting,
  withShape,
  withView,
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
  live: true,
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

const teamer = (players: [string, number][], fields: Partial<Lobby> = {}): Lobby =>
  lobby({ shape: 'teamer-2v2', mode: 'teamer', seats: 4, teams: 2, players: players.map(([discord_id, team]) => ({ discord_id, team })), ...fields });

const QUESTIONS: SettingQuestion[] = [
  { id: 'huts', title: 'Huts', default_option_id: 'x1', options: [{ id: 'x1', label: '1x', emoji: '1️⃣' }, { id: 'x1_5', label: '1.5x', emoji: '2️⃣' }] },
  { id: 'map', title: 'Map', default_option_id: 'pangea', options: [{ id: 'pangea', label: 'Pangaea', emoji: '🌐' }] },
];
const NAMES = new Map([['LEADER_A', 'Abe'], ['LEADER_B', 'Bea']]);
const CTX = { questions: QUESTIONS, names: NAMES, playerNames: new Map([['100', 'Host'], ['200', 'Ann'], ['300', 'Bo']]) };

const view = (l: Lobby) => ({ lobby: l, names: NAMES, questions: QUESTIONS, link: lobbyLinkOf(l.steam_link, REDIRECT) });
const textOf = (panel: Panel): string => (panel.body ?? []).map((b) => ('text' in b ? b.text : '')).join('\n');
type Json = { custom_id: string; options?: { label: string; value: string; default?: boolean }[] };
const componentsOf = (panel: Panel): Json[] => (panel.actions ?? []).flatMap((r) => r.components.map((c) => c.toJSON() as Json));
const verbsOf = (panel: Panel): string[] => componentsOf(panel).map((c) => c.custom_id.split(':').slice(1).filter((_, i) => i !== 1).join(':'));

test('a Civ6 lobby link goes out through the redirect; none, or any other, gives no link', () => {
  assert.equal(lobbyLinkOf(` ${LINK} `, REDIRECT), `${REDIRECT}/civ6/109775241000000000/76561198000000000`);
  assert.equal(lobbyLinkOf('steam://joinlobby/1295660/109775241000000000/76561198000000000', REDIRECT), null);
  assert.equal(lobbyLinkOf(null, REDIRECT), null);
});

test('a live lobby shows its link, seats, settings and bans, and the editor button', () => {
  const panel = lobbyPanel(view(lobby({ rules: 'No early war', settings: [{ id: 'huts', value: 'x1_5', by: 'host' }], bans: [{ token: 'LEADER_A', kind: 'leader', by: 'host' }] })));
  assert.equal(panel.title, 'Civ6 FFA, 8 seats lobby');
  assert.equal(panel.subtitle, '2/8 seats · Standard draft');
  const body = textOf(panel);
  assert.match(body, /\[Join the Steam lobby\]\(https:\/\/dev-lobbylink\.elementalengine\.net\/civ6\//);
  assert.match(body, /1\. <@100> \(host\)\n2\. <@200>/);
  assert.match(body, /No early war/);
  assert.match(body, /\*\*Settings\*\*\nHuts: 1\.5x/);
  assert.match(body, /\*\*Leader bans\*\*\nAbe/);
  assert.deepEqual(verbsOf(panel), ['join', 'leave', 'start', 'edit', 'cancel']);
  assert.doesNotMatch(textOf(lobbyPanel(view(lobby({ steam_link: null })))), /Join the Steam lobby/);
});

test('a drafted lobby keeps its link and loses its buttons; a cancelled one says why', () => {
  const drafted = lobbyPanel(view(lobby({ status: 'done' })));
  assert.equal(drafted.title, 'Civ6 FFA, 8 seats lobby: drafted');
  assert.equal(drafted.actions, undefined);
  assert.match(textOf(drafted), /Join the Steam lobby/);
  const closed = lobbyPanel(view(lobby({ status: 'cancelled', cancel_reason: 'idle' })));
  assert.equal(closed.subtitle, 'Closed after 2.5 hours with no activity');
  assert.equal(closed.actions, undefined);
});

test('each draft is its own message, named for its player or its team', () => {
  const ffa = lobbyDraftPanels(lobby({ pools: [{ player_id: '100', team: null, leaders: ['LEADER_A', 'LEADER_B'] }] }), NAMES);
  assert.equal(ffa[0]!.title, '<@100>');
  assert.equal(textOf(ffa[0]!), 'Abe\nBea');
  const team = lobbyDraftPanels(teamer([['100', 1], ['200', 2], ['300', 1]], { pools: [{ player_id: null, team: 1, leaders: ['LEADER_A'] }] }), NAMES);
  assert.equal(team[0]!.title, 'Team 1');
  assert.equal(textOf(team[0]!), '-# <@100>, <@300>\nAbe');
});

test('in setup the editor confirms or cancels; once live it saves or reverts', () => {
  const setup = editorPanel(draftOf(lobby({ live: false })), CTX);
  assert.equal(setup.title, 'Set up your lobby');
  assert.deepEqual(verbsOf(setup), ['view:settings', 'bans', 'view:lobby', 'confirm', 'discard']);
  const live = editorPanel(draftOf(lobby()), CTX);
  assert.equal(live.title, 'Edit your lobby');
  assert.deepEqual(verbsOf(live), ['view:settings', 'bans', 'view:lobby', 'done', 'revert']);
});

test('the draft holds every change until it is saved whole', () => {
  let d = draftOf(lobby({ settings: [{ id: 'huts', value: 'x1', by: 'host' }] }));
  d = withSetting(withSetting(d, 'map', 'pangea'), 'huts', NOT_FIXED);
  d = withBans(withShape(withKick(d, '200'), 'ffa-12'), ['LEADER_A', 'LEADER_A']);
  assert.deepEqual(editOf(d), { shape: 'ffa-12', settings: { map: 'pangea' }, bans: ['LEADER_A'], teams: {}, removed: ['200'] });
  const main = editorPanel(d, CTX);
  assert.match(textOf(main), /FFA, 12 seats · 1\/12 seated/);
  assert.match(textOf(main), /Map: Pangaea/);
  assert.match(textOf(main), /Removing <@200>/);
});

test('game settings are one menu each, showing the draft', () => {
  const d = withView(withSetting(draftOf(lobby()), 'huts', 'x1_5'), 'settings');
  const menus = componentsOf(editorPanel(d, CTX));
  assert.deepEqual(menus.map((m) => m.custom_id.split(':').slice(1).filter((_, i) => i !== 1).join(':')), ['setting:huts', 'setting:map', 'view:main']);
  assert.equal(menus[0]!.options!.find((o) => o.default)?.value, 'x1_5');
  assert.equal(menus[1]!.options!.find((o) => o.default)?.value, NOT_FIXED);
});

test('the lobby view resizes within the mode, moves onto teams with room and removes anyone but the host', () => {
  const ffa = componentsOf(editorPanel(withView(draftOf(lobby()), 'lobby'), CTX));
  assert.deepEqual(ffa[0]!.options!.map((o) => o.value), ['ffa-8', 'ffa-10', 'ffa-12', 'ffa-14']);
  assert.deepEqual(ffa[1]!.options!.map((o) => o.label), ['Ann']);
  const d = withView(draftOf(teamer([['100', 1], ['200', 2], ['300', 1]])), 'lobby');
  const menus = componentsOf(editorPanel(d, CTX));
  assert.deepEqual(menus[0]!.options!.map((o) => o.value), ['teamer-2v2', 'teamer-3v3', 'teamer-4v4', 'teamer-5v5']);
  assert.deepEqual(menus[1]!.options!.map((o) => o.value), ['100:2', '300:2']);
  assert.equal(menus[1]!.options![0]!.label, 'Host to Team 2');
  const moved = withMove(d, '300', 2);
  assert.deepEqual(componentsOf(editorPanel(moved, CTX))[1]!.options!.map((o) => o.value), ['200:1', '300:1']);
  assert.deepEqual(componentsOf(editorPanel(moved, CTX))[2]!.options!.map((o) => o.value), ['200', '300']);
  assert.deepEqual(editOf(withMove(moved, '300', 1)).teams, {});
  const crowded = teamer([['100', 1], ['200', 1], ['300', 1]], { shape: 'teamer-3v3', seats: 6 });
  assert.deepEqual(componentsOf(editorPanel(withView(draftOf(crowded), 'lobby'), CTX))[0]!.options!.map((o) => o.value), ['teamer-3v3', 'teamer-4v4', 'teamer-5v5']);
});

test('browse links each open lobby to its post', () => {
  assert.match(textOf(openLobbiesPanel([lobby()])), /\*\*FFA, 8 seats\*\* · 2\/8 · hosted by <@100> · \[open\]\(https:\/\/discord\.com\/channels\/1\/2\/3\)/);
  assert.match(textOf(openLobbiesPanel([])), /No lobby is open here/);
});

test('every lobby panel fits Discord, and the ban form ticks the draft’s bans', () => {
  const fourteen = lobby({ shape: 'ffa-14', seats: 14, players: Array.from({ length: 14 }, (_, i) => ({ discord_id: String(100 + i), team: null })) });
  const nine: SettingQuestion[] = Array.from({ length: 9 }, (_, i) => ({ ...QUESTIONS[0]!, id: `q${i}` }));
  const ctx = { ...CTX, questions: nine };
  for (const v of ['main', 'settings', 'lobby'] as const) container(editorPanel(withView(draftOf(fourteen), v), ctx));
  container(lobbyPanel(view(fourteen)));
  const rows = { leaders: Array.from({ length: 89 }, (_, i) => ({ token: `LEADER_${i}`, name: `L${i}`, display: `Leader ${i}` })), civs: [] } as unknown as CivDataResponse;
  const form = lobbyBanForm(withBans(draftOf(lobby()), ['LEADER_3']), rows, new Map()).toJSON();
  assert.equal(form.components.length, 4);
  const ticked = form.components.flatMap((c) => (c as unknown as { component: { options: { value: string; default?: boolean }[] } }).component.options.filter((o) => o.default).map((o) => o.value));
  assert.deepEqual(ticked, ['LEADER_3']);
});
