import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { CivDataResponse, LobbyDocument } from '../../api/types.js';
import { civNamesOf, container, type Panel } from '../kit/index.js';
import { BROWSE_LOBBIES_ID, lobbyDonePanel, lobbyLabel, lobbyListPanel, lobbyOpenPanel, openLobbyId } from './lobby.js';

const done = (over: Partial<LobbyDocument> = {}): LobbyDocument =>
  ({
    _id: '652f1a2b3c4d5e6f7a8b9c0d',
    phase: 'complete',
    revision: 9,
    guild_id: 'g',
    channel_id: '200',
    voice_channel_id: 'v',
    host_discord_id: '100',
    edition: 'civ6',
    game_type: 'duel',
    seat_count: 2,
    min_seats: 2,
    seats: [
      { seat_index: 0, discord_id: '100', pick: 'LEADER_CATHERINE_DE_MEDICI_ALT' },
      { seat_index: 1, discord_id: '101', pick: 'LEADER_UNKNOWN_MOD' },
    ],
    settings: { map: 'pangaea', draft_mode: 'standard' },
    questions: [{ id: 'map', title: 'Map', options: [{ id: 'pangaea', label: 'Pangaea' }] }],
    bans: { leader: ['LEADER_CATHERINE_DE_MEDICI_ALT'] },
    ...over,
  }) as LobbyDocument;

const civData = {
  edition: 'civ6',
  leader_data_version: 3,
  leaders: [
    {
      token: 'LEADER_CATHERINE_DE_MEDICI_ALT',
      name: 'FranceCatherineMagnificence',
      display: 'Catherine de Medici (Magnificence)',
      emoji_id: '1464719586304848032',
    },
  ],
  civs: [],
} as unknown as CivDataResponse;

// The bot's own emoji, by name.
const EMOJIS = new Map([['FranceCatherineMagnificence', '1464719586304848032']]);

const textOf = (panel: Panel): string =>
  (panel.body ?? []).map((b) => ('text' in b ? b.text : '')).join('\n');

test('the button ids are the ones posted lobbies already carry', () => {
  assert.equal(openLobbyId(done()), 'lobby:open:652f1a2b3c4d5e6f7a8b9c0d');
  assert.equal(BROWSE_LOBBIES_ID, 'lobby:browse');
});

test('a lobby is named the way players say it', () => {
  assert.equal(lobbyLabel(done()), 'Civ6 Duel');
  assert.equal(lobbyLabel(done({ game_type: 'ffa', seat_count: 8 })), 'Civ6 FFA');
  assert.equal(lobbyLabel(done({ edition: 'civ7', game_type: 'teamer', seat_count: 6 })), 'Civ7 Teamer 3v3');
  assert.equal(lobbyLabel(done({ game_type: 'teamer', seat_count: 8, settings: { draft_mode: 'cwc' } })), 'Civ6 CWC 4v4');
});

test('an open lobby lists every seat and carries its two buttons', () => {
  const panel = lobbyOpenPanel(done({ phase: 'lobby', seats: [{ seat_index: 0, discord_id: '100' }], host_rules: 'No early war' }));
  assert.match(textOf(panel), /^1\. <@100> \u00b7 host$/m);
  assert.match(textOf(panel), /^2\. \*open\*$/m);
  assert.match(textOf(panel), /No early war/);
  const json = container(panel).toJSON();
  assert.ok(json.components.length < 40);
});

test('the browse list names each lobby with its phase and host', () => {
  const panel = lobbyListPanel([done({ phase: 'settings' })]);
  assert.match(textOf(panel), /\*\*Civ6 Duel\*\* \u00b7 2\/2 seated \u00b7 voting/);
  assert.match(textOf(panel), /Hosted by <@100> in <#200>/);
});

test('a finished lobby names its settings and picks the way players read them', () => {
  const panel = lobbyDonePanel(done(), civNamesOf(civData, EMOJIS));
  const body = textOf(panel);
  assert.equal(panel.tone, 'success');
  assert.match(body, /<:FranceCatherineMagnificence:1464719586304848032> Catherine de Medici \(Magnificence\)/);
  assert.match(body, /Unknown Mod/);
  assert.match(body, /^Map: Pangaea$/m);
  assert.match(body, /draft mode: standard/);
  // Bans are a comma list: the name without its portrait.
  assert.match(body, /\*\*Bans\*\*\nCatherine de Medici \(Magnificence\)$/);
  // A portrait the bot does not own would print as :name:, so it is left off.
  assert.doesNotMatch(textOf(lobbyDonePanel(done(), civNamesOf(civData))), /<:|:France/);
});

test('without civ data the post still goes out, in token spelling', () => {
  assert.match(textOf(lobbyDonePanel(done())), /Catherine De Medici Alt/);
});

test('a cancelled lobby says why in words', () => {
  const panel = lobbyDonePanel(done({ phase: 'cancelled', cancel_reason: 'no_pick' }));
  assert.equal(panel.tone, 'muted');
  assert.equal(textOf(panel), 'The draft ran out of time with picks missing.');
  assert.equal(textOf(lobbyDonePanel(done({ phase: 'cancelled', cancel_reason: 'odd_case' }))), 'Reason: odd case.');
});

test('a cwc post lists picks by team, a civ7 post names each civ', () => {
  const cwc = textOf(
    lobbyDonePanel(
      done({
        game_type: 'teamer',
        settings: { draft_mode: 'cwc' },
        teams: [
          { team_index: 0, leaders: ['LEADER_CATHERINE_DE_MEDICI_ALT'], civs: [] },
          { team_index: 1, leaders: ['LEADER_SHAKA'], civs: [] },
        ],
      }),
      civNamesOf(civData),
    ),
  );
  assert.match(cwc, /\*\*Team 1\*\*: .*Catherine de Medici \(Magnificence\)/);
  assert.match(cwc, /\*\*Team 2\*\*: Shaka/);

  const civ7 = textOf(
    lobbyDonePanel(
      done({ edition: 'civ7', seats: [{ seat_index: 0, discord_id: '100', pick: 'LEADER_AMINA', civ_pick: 'CIVILIZATION_AKSUM' }] }),
    ),
  );
  assert.match(civ7, /Amina \u00b7 Aksum/);
});
