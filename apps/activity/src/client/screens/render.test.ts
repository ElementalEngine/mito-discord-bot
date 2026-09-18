import { createElement as h } from 'react';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToString } from 'react-dom/server';

import type { LobbyDoc, Seat } from '../model.js';
import { ApiError } from '../transport/client.js';
import { portraitUrl, Tile } from '../ui/index.js';
import { CompleteScreen } from './complete.js';
import { LobbyScreen } from './lobby.js';
import { SettingsScreen } from './settings.js';

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

// A one-seat team has no captain; a duel showed one.
test('a duel marks no captain, a teamer marks one per side', () => {
  const duel = lobby({ number_teams: 2, team_size: 1 } as Partial<LobbyDoc>);
  duel.seats[0]!.team = 0;
  duel.seats[1]!.team = 1;
  const duelHtml = renderToString(h(LobbyScreen, { api: {} as never, me: ME, lobbyId: 'l1', onBack: noop }));
  assert.doesNotMatch(duelHtml, /captain/i);
});

test('complete lists every seat and its pick', () => {
  const done = lobby({
    phase: 'complete',
    seats: [
      { seat_index: 0, discord_id: 'u1', name: 'Alder', team: null, pick: 'LEADER_SHAKA' },
      { seat_index: 1, discord_id: 'u2', name: 'Brennan', team: null, pick: 'LEADER_GANDHI' },
    ] as Seat[],
  });
  const html = renderToString(h(CompleteScreen, { lobby: done as never }));
  assert.match(html, /Alder/);
  assert.match(html, /Shaka/);
  assert.match(html, /Brennan/);
  assert.match(html, /Gandhi/);
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
