import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { CivDataResponse, Lobby, SettingQuestion } from '../../api/types.js';
import { container, type Panel } from '../kit/index.js';
import {
  draftOf,
  editOf,
  editorPanel,
  lobbyBanForm,
  lobbyDraftPanels,
  lobbyLinkOf,
  SHAPES,
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
  phase: 'live',
  deadline: null,
  code: 'K7Q2',
  host_id: '100',
  guild_id: '1',
  channel_id: '2',
  message_id: '3',
  steam_link: LINK,
  players: [
    { discord_id: '100', team: null },
    { discord_id: '200', team: null },
  ],
  settings: [
    { id: 'huts', value: 'x1', by: 'host' },
    { id: 'map', value: 'pangea', by: 'host' },
  ],
  bans: [],
  pools: [],
  picks: [],
  vote: null,
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
const rowsOf = (panel: Panel) => [...(panel.body ?? []).flatMap((b) => (b.kind === 'row' ? [b.row] : [])), ...(panel.actions ?? [])];
const componentsOf = (panel: Panel): Json[] => rowsOf(panel).flatMap((r) => r.components.map((c) => c.toJSON() as Json));
const verbsOf = (panel: Panel): string[] => componentsOf(panel).map((c) => c.custom_id.split(':').slice(1).filter((_, i) => i !== 1).join(':'));

test('a Civ6 lobby link goes out through the redirect; none, or any other, gives no link', () => {
  assert.equal(lobbyLinkOf(` ${LINK} `, REDIRECT), `${REDIRECT}/civ6/109775241000000000/76561198000000000`);
  assert.equal(lobbyLinkOf('steam://joinlobby/1295660/109775241000000000/76561198000000000', REDIRECT), null);
  assert.equal(lobbyLinkOf(null, REDIRECT), null);
});

test('a live lobby shows its link, seats, every setting with its emoji, bans and code', () => {
  const panel = lobbyPanel(view(lobby({ settings: [{ id: 'huts', value: 'x1_5', by: 'host' }, { id: 'map', value: 'pangea', by: 'host' }], bans: [{ token: 'LEADER_A', kind: 'leader', by: 'host' }] })));
  assert.equal(panel.title, 'Civ6 FFA, 8 seats lobby');
  assert.equal(panel.subtitle, '2/8 seats · Standard draft');
  const body = textOf(panel);
  assert.match(body, /\[Join the Steam lobby\]\(https:\/\/dev-lobbylink\.elementalengine\.net\/civ6\//);
  assert.match(body, /1\. <@100> \(host\)\n2\. <@200>/);
  assert.match(body, /\*\*Settings\*\*\n2️⃣ Huts: 1\.5x\n🌐 Map: Pangaea/);
  assert.match(body, /\*\*Leader bans\*\*\nAbe/);
  assert.match(panel.footer ?? '', /Hosted by <@100> · code K7Q2 · closes after 2\.5 hours/);
  assert.deepEqual(verbsOf(panel), ['join', 'leave', 'start', 'edit']);
  assert.doesNotMatch(textOf(lobbyPanel(view(lobby({ steam_link: null })))), /Join the Steam lobby/);
});

test('a lobby that has started links to its vote or picks and has no buttons', () => {
  const vote = { channel_id: '9', messages: { status: '8', bans: '7' }, finished: [] };
  const voting = lobbyPanel(view(lobby({ phase: 'voting', vote })));
  assert.match(textOf(voting), /\[Voting on bans\]\(https:\/\/discord\.com\/channels\/1\/9\/8\)/);
  assert.equal(voting.actions, undefined);
  assert.match(textOf(lobbyPanel(view(lobby({ phase: 'picking', vote })))), /\[Picking blind\]/);
  assert.doesNotMatch(textOf(lobbyPanel(view(lobby({ phase: 'voting', vote: { ...vote, channel_id: null } })))), /Voting on/);
});

test('a drafted lobby points to its draft; a cancelled one says why', () => {
  const vote = { channel_id: '9', messages: {}, finished: [] };
  const drafted = lobbyPanel(view(lobby({ status: 'done', phase: 'voting', vote })));
  assert.equal(drafted.title, 'Civ6 FFA, 8 seats lobby: drafted');
  assert.equal(drafted.actions, undefined);
  assert.match(textOf(drafted), /### Drafted in <#9>/);
  const closed = lobbyPanel(view(lobby({ status: 'cancelled', cancel_reason: 'idle' })));
  assert.equal(closed.subtitle, 'Closed after 2.5 hours with no activity');
  assert.equal(closed.actions, undefined);
});

test('the draft opens with the game, then each player or team, or the blind picks together', () => {
  const ffa = lobbyDraftPanels(view(lobby({ status: 'done', pools: [{ player_id: '100', team: null, leaders: ['LEADER_A', 'LEADER_B'] }] })));
  assert.equal(ffa[0]!.title, 'Civ6 FFA, 8 seats draft');
  assert.match(textOf(ffa[0]!), /1️⃣ Huts: 1x/);
  assert.equal(ffa[1]!.title, '<@100>');
  assert.equal(textOf(ffa[1]!), 'Abe\nBea');
  const team = lobbyDraftPanels(view(teamer([['100', 1], ['200', 2], ['300', 1]], { pools: [{ player_id: null, team: 1, leaders: ['LEADER_A'] }] })));
  assert.equal(team[1]!.title, 'Team 1');
  assert.equal(textOf(team[1]!), '-# <@100>, <@300>\nAbe');
  const picks = [
    { player_id: '100', leader: 'LEADER_A', by: 'player' as const },
    { player_id: '200', leader: 'LEADER_B', by: 'auto' as const },
  ];
  const blind = lobbyDraftPanels(view(lobby({ draft_mode: 'blind', picks })));
  assert.equal(blind.length, 2);
  assert.equal(textOf(blind[1]!), '<@100> · Abe\n<@200> · Bea (auto pick)');
});

test('in setup the editor confirms or cancels; once live it saves or reverts', () => {
  const setup = editorPanel(draftOf(lobby({ phase: 'setup' })), CTX);
  assert.equal(setup.title, 'Set up your lobby');
  assert.deepEqual(verbsOf(setup), ['view:settings', 'bans', 'view:lobby', 'confirm', 'discard']);
  assert.match(textOf(setup), /Every game setting is set: press \*\*Confirm\*\* to open the lobby to players\. Optional: \*\*Leader bans\*\*/);
  const live = editorPanel(draftOf(lobby()), CTX);
  assert.equal(live.title, 'Edit your lobby');
  assert.deepEqual(verbsOf(live), ['view:settings', 'bans', 'view:lobby', 'done', 'revert']);
});

test('the draft holds every change until it is saved whole', () => {
  let d = withSetting(draftOf(lobby()), 'huts', 'x1_5');
  d = withBans(withShape(withKick(d, '200'), 'ffa-12'), ['LEADER_A', 'LEADER_A']);
  assert.deepEqual(editOf(d), { shape: 'ffa-12', settings: { huts: 'x1_5', map: 'pangea' }, bans: ['LEADER_A'], teams: {}, removed: ['200'] });
  const main = editorPanel(d, CTX);
  assert.match(textOf(main), /FFA, 12 seats · 1\/12 seated/);
  assert.match(textOf(main), /2️⃣ Huts: 1\.5x\n🌐 Map: Pangaea/);
  assert.match(textOf(main), /Removing <@200>/);
});

test('a new lobby starts blank: the host is told what to set, and Confirm waits for every setting', () => {
  const blank = draftOf(lobby({ phase: 'setup', settings: [], draft_mode: null }));
  const main = editorPanel(blank, CTX);
  assert.match(textOf(main), /Set each game setting under \*\*Game settings\*\*, then press \*\*Confirm\*\* \(2 still to set\)\. Optional: .*move and remove players\./);
  assert.match(textOf(main), /\u2b1c Huts: not set\n\u2b1c Map: not set/);
  type Button = Json & { disabled?: boolean };
  const confirm = () => (componentsOf(editorPanel(d, CTX)) as Button[]).find((c) => c.custom_id.includes(':confirm:'))!;
  let d = withSetting(blank, 'huts', 'x1');
  assert.equal(confirm().disabled, true);
  d = withSetting(d, 'map', 'pangea');
  assert.equal(confirm().disabled, false);
});

test('game settings show each title above its menu, with the chosen option picked', () => {
  const blank = withView(draftOf(lobby({ phase: 'setup', settings: [] })), 'settings');
  const panel = editorPanel(withSetting(blank, 'huts', 'x1_5'), CTX);
  assert.deepEqual((panel.body ?? []).map((b) => b.kind), ['text', 'row', 'text', 'row']);
  assert.deepEqual((panel.body ?? []).flatMap((b) => (b.kind === 'text' ? [b.text] : [])), ['**Huts**', '**Map**']);
  assert.match(panel.subtitle ?? '', /1 still to set/);
  const menus = componentsOf(panel);
  assert.deepEqual(menus.map((m) => m.custom_id.split(':').slice(1).filter((_, i) => i !== 1).join(':')), ['setting:huts', 'setting:map', 'view:main']);
  assert.deepEqual(menus[0]!.options!.map((o) => [o.label, o.default]), [['1x', false], ['1.5x', true]]);
  assert.equal(menus[1]!.options!.some((o) => o.default), false);
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

test('/lobby host offers Duel first, and 2v2v2 is three teams that never change size', () => {
  assert.deepEqual(Object.keys(SHAPES).slice(0, 2), ['duel', 'ffa-8']);
  const trio = teamer([['100', 1], ['200', 2], ['300', 3]], { shape: 'teamer-2v2v2', seats: 6, teams: 3 });
  const menus = componentsOf(editorPanel(withView(draftOf(trio), 'lobby'), CTX));
  assert.equal(menus.some((m) => m.custom_id.includes(':shape:')), false);
  assert.deepEqual(menus[0]!.options!.map((o) => o.value), ['100:2', '100:3', '200:1', '200:3', '300:1', '300:2']);
});

test('browse links each open lobby to its post', () => {
  assert.match(textOf(openLobbiesPanel([lobby()])), /\*\*FFA, 8 seats\*\* · 2\/8 · hosted by <@100> · \[open\]\(https:\/\/discord\.com\/channels\/1\/2\/3\)/);
  assert.match(textOf(openLobbiesPanel([lobby({ phase: 'voting' })])), /2\/8 · voting on bans · hosted/);
  assert.match(textOf(openLobbiesPanel([lobby({ phase: 'picking' })])), /2\/8 · picking blind · hosted/);
  assert.match(textOf(openLobbiesPanel([])), /No lobby is open here/);
});

test('every lobby panel fits Discord, and the ban form ticks the draft’s bans', () => {
  const fourteen = lobby({ shape: 'ffa-14', seats: 14, players: Array.from({ length: 14 }, (_, i) => ({ discord_id: String(100 + i), team: null })) });
  const ten: SettingQuestion[] = Array.from({ length: 10 }, (_, i) => ({ ...QUESTIONS[0]!, id: `q${i}` }));
  const ctx = { ...CTX, questions: ten };
  for (const v of ['main', 'settings', 'lobby'] as const) container(editorPanel(withView(draftOf(fourteen), v), ctx));
  container(lobbyPanel(view(fourteen)));
  const rows = { leaders: Array.from({ length: 89 }, (_, i) => ({ token: `LEADER_${i}`, name: `L${i}`, display: `Leader ${i}` })), civs: [] } as unknown as CivDataResponse;
  const form = lobbyBanForm(withBans(draftOf(lobby()), ['LEADER_3']), rows, new Map()).toJSON();
  assert.equal(form.components.length, 4);
  const ticked = form.components.flatMap((c) => (c as unknown as { component: { options: { value: string; default?: boolean }[] } }).component.options.filter((o) => o.default).map((o) => o.value));
  assert.deepEqual(ticked, ['LEADER_3']);
});
