import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { ParsedPlayer } from '../../../src/core/api/types.js';
import type { BaseReport } from '../../../src/features/reporting/types.js';
import {
  allPlayersHaveDiscordId,
  convertMatchToStr,
  getPlayerListMessage,
  isValidOrder,
} from '../../../src/features/reporting/format.js';

function player(p: Partial<ParsedPlayer>): ParsedPlayer {
  return {
    player_alive: true,
    team: 0,
    civ: 'CIVILIZATION_ROME',
    placement: 0,
    quit: false,
    is_sub: false,
    subbed_out: false,
    ...p,
  };
}

function report(p: Partial<BaseReport>): BaseReport {
  return {
    match_id: 'M1',
    game: 'civ6',
    turn: 100,
    map_type: 'Pangaea',
    game_mode: 'ffa',
    is_cloud: false,
    discord_messages_id_list: [],
    players: [],
    reporter_discord_id: '111',
    contest_report_list: null,
    ...p,
  };
}

test('isValidOrder: token count must equal team count and be in range', () => {
  const players = [player({ team: 0 }), player({ team: 1 })];
  assert.equal(isValidOrder('2 1', players), true);
  assert.equal(isValidOrder('3 1', players), false); // 3 > 2 teams
  assert.equal(isValidOrder('1', players), false); // wrong token count
});

test('getPlayerListMessage: placement sort by default, new_order sort when valid', () => {
  const players = [
    player({ discord_id: '1', user_name: 'A', team: 0, placement: 2 }),
    player({ discord_id: '2', user_name: 'B', team: 1, placement: 0 }),
  ];
  const r = report({ players });
  assert.equal(getPlayerListMessage(r), '<@2> (B)\t\t<@1> (A)'); // B placed higher
  assert.equal(getPlayerListMessage(r, '2 1'), '<@2> (B)\t\t<@1> (A)'); // team1 ranked 1st
});

test('convertMatchToStr: civ6 vs civ7 meta lines (civ7 includes Age)', () => {
  const civ6 = report({ game: 'civ6', players: [player({ discord_id: '1' })] });
  const s6 = convertMatchToStr(civ6, true);
  assert.ok(s6.startsWith('Game: civ6 | Turn: 100 | Map: Pangaea | Mode: ffa'));
  assert.ok(!s6.includes('Age:'));

  const civ7 = report({ game: 'civ7', players: [player({ discord_id: '1' })] }) as BaseReport & { age: string };
  civ7.age = 'Antiquity';
  const s7 = convertMatchToStr(civ7, true);
  assert.ok(s7.includes('Age: Antiquity'));
});

test('allPlayersHaveDiscordId: rejects missing / sentinel ids', () => {
  assert.equal(allPlayersHaveDiscordId([player({ discord_id: '123' })]), true);
  assert.equal(allPlayersHaveDiscordId([player({ discord_id: '-1' })]), false);
  assert.equal(allPlayersHaveDiscordId([player({ discord_id: '0' })]), false);
  assert.equal(allPlayersHaveDiscordId([player({ discord_id: undefined })]), false);
});
