import { createElement as h } from 'react';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToString } from 'react-dom/server';

import type { LobbyDoc, Seat } from '../model.js';
import { ApiError } from '../transport/client.js';
import { Countdown, portraitUrl, Tile, timeLeft } from '../ui/index.js';
import { banRule, BansScreen } from './bans.js';
import { CompleteScreen, decidedBy } from './complete.js';
import { DraftScreen } from './draft.js';
import { WaitingRoom } from './lobby.js';
import { choose, SettingsScreen } from './settings.js';

const ME = { uid: 'u1', name: 'Alder', staff: false };
const noop = async () => undefined;

function lobby(over: Partial<LobbyDoc> = {}): LobbyDoc {
  return {
    _id: 'l1',
    phase: 'lobby',
    revision: 1,
    edition: 'civ6',
    game_type: 'duel',
    seat_count: 2,
    min_seats: 2,
    host_discord_id: 'u1',
    voice_channel_id: 'v1',
    seats: [
      { seat_index: 0, discord_id: 'u1', name: 'Alder', team: null },
      { seat_index: 1, discord_id: 'u2', name: 'Brennan', team: null },
    ] as Seat[],
    ...over,
  } as LobbyDoc;
}

// A question's text lives in `title`; rendering `prompt` left six panels of
// unlabelled options on screen.
test('a settings question shows its title and every option', () => {
  const doc = lobby({
    phase: 'settings',
    questions: [
      { id: 'friends_allies', title: 'Official Friends/Allies', options: [
        { id: 'none', label: 'None', emoji: '0\ufe0f\u20e3' },
        { id: 'one', label: 'One' },
      ] },
    ],
  } as Partial<LobbyDoc>);
  const html = renderToString(h(SettingsScreen, { lobby: doc as never, mine: doc.seats[0], act: noop }));
  assert.match(html, /Official Friends\/Allies/);
  assert.match(html, /None/);
  assert.match(html, /One/);
});

// A duel is two seats, not two teams of one: the host sat under "No team
// yet" with two empty team panels beside it.
test('a duel seats like an ffa, with no teams and no captain', () => {
  const duel = lobby({ number_teams: 2, team_size: 1 } as Partial<LobbyDoc>);
  const html = renderToString(h(WaitingRoom, { lobby: duel, me: ME, act: noop, onBack: noop }));
  assert.doesNotMatch(html, /captain/i);
  // React splits "Team " and the number with a comment when it renders.
  assert.doesNotMatch(html, /Team (<!-- -->)?\d|No team yet/);
  assert.match(html, /Alder/);
  assert.doesNotMatch(html, /rev /);
});

test('a teamer still shows its sides', () => {
  const teamer = lobby({ game_type: 'teamer', seat_count: 4, number_teams: 2, team_size: 2 } as Partial<LobbyDoc>);
  teamer.seats[0]!.team = 0;
  const html = renderToString(h(WaitingRoom, { lobby: teamer, me: ME, act: noop, onBack: noop }));
  assert.match(html, /Team (<!-- -->)?1/);
  assert.match(html, /Team (<!-- -->)?2/);
});

test('complete lists every seat and its pick', () => {
  const done = lobby({
    phase: 'complete',
    seats: [
      { seat_index: 0, discord_id: 'u1', name: 'Alder', team: null, pick: 'LEADER_SHAKA' },
      { seat_index: 1, discord_id: 'u2', name: 'Brennan', team: null, pick: 'LEADER_GANDHI' },
    ] as Seat[],
  });
  const html = renderToString(h(CompleteScreen, { civData: CIV_DATA as never, lobby: done as never }));
  assert.match(html, /Alder/);
  assert.match(html, /Shaka/);
  assert.match(html, /Brennan/);
  assert.match(html, /Gandhi/);
});

// "map_type: pangaea" read as a database row. The questions travel with a
// finished lobby, so the summary reads as the ballot did.
test('complete names settings by their titles and labels, and marks a draw', () => {
  const done = lobby({
    phase: 'complete',
    settings: { map: 'pangaea', duration: 'none', draft_mode: 'standard' },
    questions: [
      { id: 'duration', title: 'Game Duration', options: [{ id: 'none', label: 'No limit' }] },
      { id: 'map', title: 'Map', options: [{ id: 'pangaea', label: 'Pangaea' }, { id: 'lakes', label: 'Lakes' }] },
    ],
    seats: [
      { seat_index: 0, discord_id: 'u1', name: 'Alder', team: null, ballot: { map: 'pangaea', duration: 'none' } },
      { seat_index: 1, discord_id: 'u2', name: 'Brennan', team: null, ballot: { map: 'lakes', duration: 'none' } },
    ] as Seat[],
  } as Partial<LobbyDoc>);
  const html = renderToString(h(CompleteScreen, { civData: CIV_DATA as never, lobby: done as never }));
  assert.match(html, /Game Duration/);
  assert.match(html, /No limit/);
  assert.match(html, /Pangaea/);
  assert.match(html, /tie, drawn/);
  assert.ok(html.indexOf('Game Duration') < html.indexOf('Map'), 'question order, not storage order');
  assert.match(html, /draft mode/);
  assert.doesNotMatch(html, /map_type|pangaea</);
});

test('a setting is a draw only when the top count ties', () => {
  const seat = (ballot: Record<string, string> | undefined) => ({ seat_index: 0, discord_id: 'x', team: null, ballot }) as Seat;
  assert.equal(decidedBy([seat({ q: 'a' }), seat({ q: 'a' })], 'q'), null);
  assert.equal(decidedBy([seat({ q: 'a' }), seat({ q: 'b' })], 'q'), 'draw');
  assert.equal(decidedBy([seat({ q: 'a|b' }), seat({ q: 'a' })], 'q'), null);
  assert.equal(decidedBy([seat({ q: 'a' }), seat(undefined)], 'q'), 'default');
});

// The grid is the screen's whole point: a tile carries the face, the name
// and the civ, and a banned leader is not offerable a second time.
test('a tile renders its portrait from the emoji id', () => {
  const html = renderToString(h(Tile, { emojiId: '123456789012345678', label: 'Shaka', sub: 'Zulu' }));
  assert.match(html, /cdn\.discordapp\.com\/emojis\/123456789012345678\.png/);
  assert.match(html, /Shaka/);
  assert.match(html, /Zulu/);
});

test('a tile without a portrait still names its leader', () => {
  const html = renderToString(h(Tile, { emojiId: null, label: 'Dai Viet' }));
  assert.doesNotMatch(html, /cdn\.discordapp\.com/);
  assert.match(html, /Dai Viet/);
});

test('the portrait url stays inside the cdn ceiling', () => {
  assert.equal(portraitUrl('1', 128), 'https://cdn.discordapp.com/emojis/1.png?size=128');
});

// "409 CONFLICT" told a player nothing; the server writes a sentence.
test('an api error shows the server sentence, not the code', () => {
  const spoken = new ApiError(409, 'CONFLICT', false, 'You are already seated in another open lobby.');
  assert.equal(spoken.message, 'You are already seated in another open lobby.');
  assert.equal(spoken.code, 'CONFLICT');
});

test('an api error with no sentence falls back to the code', () => {
  assert.equal(new ApiError(500, 'INTERNAL', false).message, '500 INTERNAL');
});

const CIV_DATA = {
  leaders: [
    { token: 'LEADER_SHAKA', name: 'ZuluShaka', civ: 'CIVILIZATION_ZULU', emoji_id: '111' },
    { token: 'LEADER_GANDHI', name: 'IndiaGandhi', civ: 'CIVILIZATION_INDIA', emoji_id: '222' },
  ],
  civs: [],
};

// A banned leader is gone from the grid: offering it again is a refusal
// waiting to happen.
test('the ban grid drops what has already been banned', () => {
  const doc = lobby({
    phase: 'bans',
    ban_caps: { leader: 20, civ: 0 },
    bans: { leader: ['LEADER_SHAKA'] },
  } as Partial<LobbyDoc>);
  const html = renderToString(
    h(BansScreen, { civData: CIV_DATA as never, lobby: doc as never, me: ME, mine: doc.seats[0], act: noop }),
  );
  assert.match(html, /Gandhi/);
  assert.match(html, /emojis\/222/);
  assert.doesNotMatch(html, /emojis\/111/);
});

// Only the captain in turn may act; everyone else watches.
test('a cwc turn belongs to one captain', () => {
  const mine = lobby({
    phase: 'bans',
    ban_caps: { leader: 20, civ: 0 },
    ban_order: ['u1', 'u2'],
    turn_index: 0,
  } as Partial<LobbyDoc>);
  const yours = renderToString(
    h(BansScreen, { civData: CIV_DATA as never, lobby: mine as never, me: ME, mine: mine.seats[0], act: noop }),
  );
  assert.match(yours, /Your ban/);

  const theirs = lobby({ ...mine, turn_index: 1 } as Partial<LobbyDoc>);
  const html = renderToString(
    h(BansScreen, { civData: CIV_DATA as never, lobby: theirs as never, me: ME, mine: theirs.seats[0], act: noop }),
  );
  assert.match(html, /Waiting on/);
  assert.match(html, /Brennan/);
  assert.match(html, /disabled=""/);
});

test('the draft shows the pool it was dealt, with portraits', () => {
  const doc = lobby({ phase: 'draft' } as Partial<LobbyDoc>);
  doc.seats[0]!.pool = ['LEADER_SHAKA', 'LEADER_GANDHI'];
  const html = renderToString(
    h(DraftScreen, { civData: CIV_DATA as never, lobby: doc as never, me: ME, mine: doc.seats[0], act: noop }),
  );
  assert.match(html, /Shaka/);
  assert.match(html, /emojis\/111/);
  assert.match(html, /choose a leader/i);
  assert.doesNotMatch(html, /and a civ/);
});

// The tile reads as the game: "Catherine de Medici (Black Queen)", not the
// token, and the civ beneath it.
test('tiles show display names, with the token only as a fallback', () => {
  const named = {
    leaders: [
      { token: 'LEADER_CATHERINE_DE_MEDICI', name: 'FranceCatherineBlackQueen', display: 'Catherine de Medici (Black Queen)', civ: 'CIVILIZATION_FRANCE', civ_display: 'France', emoji_id: '333' },
      { token: 'LEADER_T_ROOSEVELT', name: 'AmericaTeddyBullMoose', emoji_id: '444' },
    ],
    civs: [],
  };
  const doc = lobby({ phase: 'draft' } as Partial<LobbyDoc>);
  doc.seats[0]!.pool = ['LEADER_CATHERINE_DE_MEDICI', 'LEADER_T_ROOSEVELT'];
  const html = renderToString(h(DraftScreen, { civData: named as never, lobby: doc as never, me: ME, mine: doc.seats[0], act: noop }));
  assert.match(html, /Catherine de Medici \(Black Queen\)/);
  assert.match(html, /France/);
  assert.match(html, /T Roosevelt/);
});

// A pick seen early is a counter-pick: the draft says who has locked in,
// never what they chose.
test('the draft says who has locked in, not what they picked', () => {
  const doc = lobby({ phase: 'draft' } as Partial<LobbyDoc>);
  doc.seats[0]!.pool = ['LEADER_SHAKA'];
  doc.seats[1]!.ready = true;
  const html = renderToString(h(DraftScreen, { civData: CIV_DATA as never, lobby: doc as never, me: ME, mine: doc.seats[0], act: noop }));
  assert.match(html, /locked in/);
  assert.match(html, /1\/2 locked in/);
  assert.match(html, /choosing/);
});

test('the phase deadline shows as minutes and seconds', () => {
  const now = Date.parse('2026-10-20T12:00:00Z');
  assert.equal(timeLeft('2026-10-20T12:04:05Z', now), '4:05 left');
  assert.equal(timeLeft('2026-10-20T12:00:09Z', now), '0:09 left');
  assert.equal(timeLeft('2026-10-20T11:59:00Z', now), 'time up');
  assert.match(renderToString(h(Countdown, { until: new Date(Date.now() + 120_000).toISOString() })), /left/);
  assert.equal(renderToString(h(Countdown, { until: null })), '');
});

test('the bans screen states the rule before anyone bans', () => {
  assert.equal(banRule(2), 'A ban lands only when both players choose it.');
  assert.equal(banRule(6), 'A ban lands when 4 of 6 players choose it.');
  const doc = lobby({ phase: 'bans', ban_caps: { leader: 2, civ: 0 } } as Partial<LobbyDoc>);
  const html = renderToString(
    h(BansScreen, { civData: CIV_DATA as never, lobby: doc as never, me: ME, mine: doc.seats[0], act: noop }),
  );
  assert.match(html, /only when both players choose it/);
  assert.match(html, /private until then/);
});

// The ballot opens on the catalogue's default, and a question that takes two
// answers takes two.
test('a ballot starts on the default and a multi-choice keeps its cap', () => {
  const doc = lobby({
    phase: 'settings',
    questions: [{ id: 'sea', title: 'Sea Level', default_option_id: 'high', options: [{ id: 'low', label: 'Low' }, { id: 'high', label: 'High' }] }],
  } as Partial<LobbyDoc>);
  const html = renderToString(h(SettingsScreen, { lobby: doc as never, mine: doc.seats[0], act: noop }));
  assert.match(html, /border-accent[^>]*>High/);
  assert.equal(choose('a', 'b', 1), 'b');
  assert.equal(choose('a', 'b', 2), 'a|b');
  assert.equal(choose('a|b', 'c', 2), 'b|c');
  assert.equal(choose('a|b', 'a', 2), 'b');
  assert.equal(choose('a', 'a', 2), 'a');
});

// civ7 deals a civ pool beside the leader pool. A leader alone would lock the
// seat with no civ, so the button waits for both.
test('a civ7 draft asks for a leader and a civ before it locks in', () => {
  const doc = lobby({ phase: 'draft', edition: 'civ7' } as Partial<LobbyDoc>);
  doc.seats[0]!.pool = ['LEADER_SHAKA'];
  doc.seats[0]!.civ_pool = ['CIVILIZATION_ROME'];
  const html = renderToString(h(DraftScreen, { civData: CIV_DATA as never, lobby: doc as never, me: ME, mine: doc.seats[0], act: noop }));
  assert.match(html, /choose a leader and a civ/);
  assert.match(html, /Civilizations/);
  assert.match(html, /Rome/);
  assert.match(html, /disabled="">Lock in/);
});

const CWC_DRAFT = {
  phase: 'draft',
  game_type: 'teamer',
  settings: { draft_mode: 'cwc' },
  pool: ['LEADER_SHAKA', 'LEADER_GANDHI'],
  pick_order: ['u1', 'u2', 'u2', 'u1'],
  turn_index: 1,
  teams: [
    { team_index: 0, leaders: ['LEADER_SHAKA'], civs: [] },
    { team_index: 1, leaders: [], civs: [] },
  ],
} as Partial<LobbyDoc>;

// Cwc deals one shared pool and the captains take turns: the screen read the
// seat's own pool, which cwc never deals, so captains saw nothing to pick.
test('a cwc captain on the clock picks from the shared pool, minus what is taken', () => {
  const doc = lobby({
    ...CWC_DRAFT,
    turn_index: 0,
    teams: [
      { team_index: 0, leaders: [], civs: [] },
      { team_index: 1, leaders: ['LEADER_SHAKA'], civs: [] },
    ],
  });
  const html = renderToString(h(DraftScreen, { civData: CIV_DATA as never, lobby: doc as never, me: ME, mine: doc.seats[0], act: noop }));
  assert.match(html, /Your pick/);
  assert.match(html, /emojis\/222/);
  assert.doesNotMatch(html, /emojis\/111/);
  assert.match(html, /Pick 1 of 4/);
});

test('the other captain watches, and every team shows what it has taken', () => {
  const doc = lobby(CWC_DRAFT);
  const html = renderToString(h(DraftScreen, { civData: CIV_DATA as never, lobby: doc as never, me: ME, mine: doc.seats[0], act: noop }));
  assert.match(html, /Waiting on (<!-- -->)?Brennan/);
  assert.match(html, /Shaka/);
  assert.match(html, /no picks yet/);
  assert.doesNotMatch(html, />Lock in</);
});

test('a cwc summary lists picks by team, a civ7 one names each civ', () => {
  const cwc = lobby({
    ...CWC_DRAFT,
    phase: 'complete',
    teams: [
      { team_index: 0, leaders: ['LEADER_SHAKA'], civs: [] },
      { team_index: 1, leaders: ['LEADER_GANDHI'], civs: [] },
    ],
  });
  const teams = renderToString(h(CompleteScreen, { civData: CIV_DATA as never, lobby: cwc as never }));
  assert.match(teams, /Team (<!-- -->)?1/);
  assert.match(teams, /Shaka/);
  assert.match(teams, /Gandhi/);

  const civ7 = lobby({ phase: 'complete', edition: 'civ7' } as Partial<LobbyDoc>);
  civ7.seats[0]!.pick = 'LEADER_SHAKA';
  civ7.seats[0]!.civ_pick = 'CIVILIZATION_ROME';
  assert.match(renderToString(h(CompleteScreen, { civData: CIV_DATA as never, lobby: civ7 as never })), /Rome/);
});

test('settings list who is still voting', () => {
  const doc = lobby({ phase: 'settings', questions: [] } as Partial<LobbyDoc>);
  doc.seats[1]!.ready = true;
  const html = renderToString(h(SettingsScreen, { lobby: doc as never, mine: doc.seats[0], act: noop }));
  assert.match(html, /voting/);
  assert.match(html, />ready</);
});
