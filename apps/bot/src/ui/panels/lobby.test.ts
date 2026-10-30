import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { CivDataResponse, Lobby, SettingQuestion } from '../../api/types.js';
import { container, type Panel } from '../kit/index.js';
import {
  draftOf,
  editOf,
  editorPanel,
  lobbyBanForm,
  lobbyLinkOf,
  lobbyPanel,
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
  message: null,
  lfg: false,
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
  { id: 'huts', title: 'Huts', default_option_id: 'x1', host_only: false, options: [{ id: 'x1', label: '1x', emoji: '1️⃣' }, { id: 'x1_5', label: '1.5x', emoji: '2️⃣' }] },
  { id: 'map', title: 'Map', default_option_id: 'pangea', host_only: false, options: [{ id: 'pangea', label: 'Pangaea', emoji: '🌐' }] },
];
const NAMES = new Map([['LEADER_A', 'Abe'], ['LEADER_B', 'Bea']]);
const CTX = { questions: QUESTIONS, names: NAMES, playerNames: new Map([['100', 'Host'], ['200', 'Ann'], ['300', 'Bo']]) };

const view = (l: Lobby, lfgRole: string | null = null) => ({ lobby: l, names: NAMES, questions: QUESTIONS, link: lobbyLinkOf(l.steam_link, REDIRECT), lfgRole });
const textOf = (panel: Panel): string => (panel.body ?? []).map((b) => ('text' in b ? b.text : '')).join('\n');
type Json = { custom_id: string; options?: { label: string; value: string; default?: boolean }[] };
const rowsOf = (panel: Panel) => [...(panel.body ?? []).flatMap((b) => (b.kind === 'row' ? [b.row] : [])), ...(panel.actions ?? [])];
const componentsOf = (panel: Panel): Json[] => rowsOf(panel).flatMap((r) => r.components.map((c) => c.toJSON() as Json));

test('a Civ6 lobby link goes out through the redirect; none, or any other, gives no link', () => {
  assert.equal(lobbyLinkOf(` ${LINK} `, REDIRECT), `${REDIRECT}/civ6/109775241000000000/76561198000000000`);
  assert.equal(lobbyLinkOf('steam://joinlobby/1295660/109775241000000000/76561198000000000', REDIRECT), null);
  assert.equal(lobbyLinkOf(null, REDIRECT), null);
});

test("a live lobby pings the LFG role until full, then counts down to its vote; the host's note shows", () => {
  const open = textOf(lobbyPanel(view(lobby({ message: 'no novices' }), '77')));
  assert.match(open, /^<@&77> looking for players/);
  assert.match(open, /\*\*From the host\*\*\nno novices/);
  assert.doesNotMatch(open, /Full: the bans vote/);
  const full = textOf(lobbyPanel(view(lobby({ deadline: '2026-10-27T12:10:00Z' }), '77')));
  assert.match(full, /### Full: the bans vote starts <t:1793103000:R>\n-# Or sooner, when the host presses Start\./);
  assert.doesNotMatch(full, /<@&77>|From the host/);
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
