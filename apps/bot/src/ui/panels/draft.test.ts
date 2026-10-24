import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { CivDataResponse, DealResponse } from '../../api/types.js';
import { civNamesOf, container, LIMITS, type Panel } from '../kit/index.js';
import { banForm, banMenus, dealRequest, draftPanels, packChoice, unpackChoice, type DraftChoice } from './draft.js';

const civ6: DraftChoice = { edition: 'civ6', mode: 'ffa', drafts: 8, leaders: 3, civs: null, age: null };
const civ7: DraftChoice = { edition: 'civ7', mode: 'teamer', drafts: 2, leaders: 4, civs: 3, age: 'AGE_ANTIQUITY' };

const pad = (i: number): string => String(i).padStart(2, '0');
const leaders = (n: number) => Array.from({ length: n }, (_, i) => ({ token: `LEADER_${pad(i)}`, name: `L${i}`, display: `Leader ${pad(i)}` }));
const data = (leaderCount: number, civs: { token: string; age_pool: string }[] = []) =>
  ({ edition: 'civ7', leader_data_version: 1, leaders: leaders(leaderCount), civs: civs.map((c) => ({ ...c, name: c.token, display: c.token })) }) as unknown as CivDataResponse;

// Each draft deals its own leaders, two at a time, in order.
const deal = (drafts: number, civs = false): DealResponse => ({
  pools: Array.from({ length: drafts }, (_, i) => ({ leaders: [`LEADER_${pad(2 * i)}`, `LEADER_${pad(2 * i + 1)}`], civs: civs ? ['CIV_A', 'CIV_B'] : [] })),
  bans: { leader: [], civ: [] },
});

const textOf = (panels: Panel[]): string => panels.flatMap((p) => (p.body ?? []).map((b) => ('text' in b ? b.text : ''))).join('\n');

test('a choice survives its trip through a form id', () => {
  for (const choice of [civ6, civ7, { ...civ7, age: null }, { ...civ6, mode: 'duel', drafts: 2 } as DraftChoice]) {
    assert.deepEqual(unpackChoice(packChoice(choice)), choice);
  }
  assert.equal(unpackChoice('not a draft'), null);
});

test('the deal asks core-api for exactly what the host chose', () => {
  assert.deepEqual(dealRequest(civ6, ['LEADER_00'], []), {
    edition: 'civ6', game_type: 'ffa', drafts: 8, leaders: 3, civs: null, starting_age: null, leader_bans: ['LEADER_00'], civ_bans: [],
  });
  assert.equal(dealRequest(civ7, [], ['CIV_A']).starting_age, 'AGE_ANTIQUITY');
  assert.equal(dealRequest(civ7, [], []).civs, 3);
});

test('the post reads the bans, then each player\'s draft one pick a line', () => {
  const panels = draftPanels({ choice: civ6, deal: deal(8), names: civNamesOf(data(16)), by: '100' });
  assert.equal(panels.length, 1);
  assert.equal(panels[0]!.title, 'Civ6 FFA draft');
  assert.equal(panels[0]!.subtitle, '8 drafts · 3 civs each');
  const body = textOf(panels);
  assert.match(body, /\*\*Bans\*\*\nLeaders: None/);
  assert.match(body, /\*\*Player n°1\*\*\nLeader 00\nLeader 01/);
  assert.ok(body.indexOf('Player n°1') < body.indexOf('Player n°8'));
  assert.equal(panels[0]!.footer, 'Drafted by <@100>');
});

test('a teamer deals a draft per team, and civ7 lists its leaders and civs apart', () => {
  const body = textOf(draftPanels({ choice: civ7, deal: deal(2, true), names: new Map(), by: '100' }));
  assert.match(body, /\*\*Team 2\*\*\n-# Leaders\n.+\n.+\n-# Civs\n.+\n.+/);
  assert.match(body, /Civs: None/);
  assert.doesNotMatch(body, /Player n/);
});

test('a long draft runs on into more posts, each within Discord\'s limit', () => {
  const panels = draftPanels({ choice: { ...civ6, drafts: 40 }, deal: deal(40), names: new Map(), by: '100' });
  assert.ok(panels.length > 1);
  assert.match(panels[1]!.title ?? '', /continued$/);
  assert.equal(panels[0]!.footer, undefined);
  for (const panel of panels) assert.ok(JSON.stringify(container(panel).toJSON()).length < LIMITS.text * 2);
  assert.match(textOf(panels), /\*\*Player n°40\*\*/);
});

test('the ban form fits the whole civ6 roster in four menus', () => {
  const form = banForm(civ6, packChoice(civ6), data(89), civNamesOf(data(89))).toJSON();
  assert.equal(form.components.length, 4);
  assert.ok(form.custom_id.length <= LIMITS.customId);
});

test('civ7 bans offer only the civs of the starting age', () => {
  const rows = data(33, [{ token: 'CIV_A', age_pool: 'AGE_ANTIQUITY' }, { token: 'CIV_E', age_pool: 'AGE_EXPLORATION' }]);
  assert.deepEqual(banMenus(civ7, rows, new Map()).civs.flat().map((o) => o.token), ['CIV_A']);
  assert.equal(banMenus({ ...civ7, age: null }, rows, new Map()).civs.flat().length, 2);
  assert.equal(banMenus(civ7, rows, new Map()).leaders.length, 2);
});
