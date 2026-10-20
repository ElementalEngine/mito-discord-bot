import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildLobbyCompleteEmbed, civNamesOf } from './lobby.js';
import type { CivDataResponse, LobbyDocument } from '../../api/types.js';

/**
 * The finished-lobby post read "map: pangaea" and "Catherine De Medici Alt".
 * It now names settings by their ballot titles and leaders by display name.
 *
 * What should break this file: posting tokens when names are known, or a
 * missing civ-data row taking the summary down with it.
 */

const done = (over: Partial<LobbyDocument> = {}): LobbyDocument =>
  ({
    _id: 'l1',
    phase: 'complete',
    revision: 9,
    guild_id: 'g',
    channel_id: 'c',
    voice_channel_id: 'v',
    host_discord_id: 'u1',
    edition: 'civ6',
    game_type: 'duel',
    seat_count: 2,
    min_seats: 2,
    seats: [
      { seat_index: 0, discord_id: 'u1', pick: 'LEADER_CATHERINE_DE_MEDICI_ALT' },
      { seat_index: 1, discord_id: 'u2', pick: 'LEADER_UNKNOWN_MOD' },
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

test('a finished lobby names its settings and picks the way players read them', () => {
  const json = buildLobbyCompleteEmbed(done(), civNamesOf(civData)).toJSON();
  assert.match(json.description ?? '', /<:FranceCatherineMagnificence:1464719586304848032> Catherine de Medici \(Magnificence\)/);
  assert.match(json.description ?? '', /Unknown Mod/);
  const settings = json.fields?.find((f) => f.name === 'Settings')?.value ?? '';
  assert.match(settings, /^Map: Pangaea$/m);
  assert.match(settings, /draft mode: standard/);
  // Bans are a comma list: the name without its portrait.
  assert.equal(json.fields?.find((f) => f.name === 'Bans')?.value, 'Catherine de Medici (Magnificence)');
});

test('without civ data the post still goes out, in token spelling', () => {
  const json = buildLobbyCompleteEmbed(done()).toJSON();
  assert.match(json.description ?? '', /Catherine De Medici Alt/);
});

test('a cancelled lobby says why', () => {
  const json = buildLobbyCompleteEmbed(done({ phase: 'cancelled', cancel_reason: 'no_pick' })).toJSON();
  assert.equal(json.description, 'no_pick');
});

test('a cwc post lists picks by team, a civ7 post names each civ', () => {
  const cwc = buildLobbyCompleteEmbed(
    done({
      game_type: 'teamer',
      settings: { draft_mode: 'cwc' },
      teams: [
        { team_index: 0, leaders: ['LEADER_CATHERINE_DE_MEDICI_ALT'], civs: [] },
        { team_index: 1, leaders: ['LEADER_SHAKA'], civs: [] },
      ],
    }),
    civNamesOf(civData),
  ).toJSON();
  assert.match(cwc.description ?? '', /\*\*Team 1\*\*: .*Catherine de Medici \(Magnificence\)/);
  assert.match(cwc.description ?? '', /\*\*Team 2\*\*: Shaka/);

  const civ7 = buildLobbyCompleteEmbed(
    done({ edition: 'civ7', seats: [{ seat_index: 0, discord_id: 'u1', pick: 'LEADER_AMINA', civ_pick: 'CIVILIZATION_AKSUM' }] }),
  ).toJSON();
  assert.match(civ7.description ?? '', /Amina \u00b7 Aksum/);
});
