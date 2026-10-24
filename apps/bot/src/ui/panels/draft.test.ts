import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { CivDataResponse, DealResponse, DraftQuestion } from '../../api/types.js';
import { civNamesOf, container, LIMITS, type Panel } from '../kit/index.js';
import { banForm, banMenus, dealRequest, draftPanels, packChoice, unpackChoice, type DraftChoice, type DraftSettings } from './draft.js';

const QUESTIONS: DraftQuestion[] = [
  { id: 'map', title: 'Map', options: [{ id: 'pangaea', label: 'Pangaea' }, { id: 'lakes', label: 'Lakes' }] },
  { id: 'wonders', title: 'Wonders', options: [{ id: 'none', label: 'None' }, { id: 'scarce', label: 'Scarce' }] },
] as DraftQuestion[];
const SETTINGS: DraftSettings = { civ6: QUESTIONS, civ7: QUESTIONS };

const civ6: DraftChoice = { edition: 'civ6', mode: 'ffa', drafts: 8, leaders: 3, civs: null, age: null, settings: { wonders: 'scarce' } };
const civ7: DraftChoice = { edition: 'civ7', mode: 'teamer', drafts: 2, leaders: 4, civs: 3, age: 'AGE_ANTIQUITY', settings: {} };

const leaders = (n: number) => Array.from({ length: n }, (_, i) => ({ token: `LEADER_${String(i).padStart(2, '0')}`, name: `L${i}`, display: `Leader ${String(i).padStart(2, '0')}` }));
const data = (leaderCount: number, civs: { token: string; age_pool: string }[] = []) =>
  ({ edition: 'civ7', leader_data_version: 1, leaders: leaders(leaderCount), civs: civs.map((c) => ({ ...c, name: c.token, display: c.token })) }) as unknown as CivDataResponse;

const deal = (seats: number, civs = false): DealResponse => ({
  pools: Array.from({ length: seats }, (_, i) => ({ leaders: [`LEADER_${String(i).padStart(2, '0')}`], civs: civs ? ['CIV_A'] : [] })),
  bans: { leader: [], civ: [] },
});

const textOf = (panels: Panel[]): string => panels.flatMap((p) => (p.body ?? []).map((b) => ('text' in b ? b.text : ''))).join('\n');

test('a choice survives its trip through a form id', () => {
  for (const choice of [civ6, civ7, { ...civ7, age: null }, { ...civ6, mode: 'duel', drafts: 2 } as DraftChoice]) {
    assert.deepEqual(unpackChoice(packChoice(choice, QUESTIONS), SETTINGS), choice);
  }
  assert.equal(unpackChoice('not a draft', SETTINGS), null);
});

test('the deal asks core-api for exactly what the host chose', () => {
  assert.deepEqual(dealRequest(civ6, ['LEADER_00'], []), {
    edition: 'civ6', game_type: 'ffa', drafts: 8, leaders: 3, civs: null, starting_age: null, leader_bans: ['LEADER_00'], civ_bans: [],
  });
  assert.equal(dealRequest(civ7, [], ['CIV_A']).starting_age, 'AGE_ANTIQUITY');
  assert.equal(dealRequest(civ7, [], []).civs, 3);
});

test('the post reads title and settings first, then each seat in order', () => {
  const panels = draftPanels({ choice: civ6, rules: 'No early war', questions: QUESTIONS, deal: deal(8), names: civNamesOf(data(8)), by: '100' });
  assert.equal(panels.length, 1);
  assert.equal(panels[0]!.title, 'Civ6 FFA draft');
  const body = textOf(panels);
  assert.ok(body.indexOf('No early war') < body.indexOf('**Seat 1**'));
  assert.match(body, /Wonders: Scarce/);
  assert.doesNotMatch(body, /Map:/);
  assert.match(body, /Leaders: None/);
  assert.ok(body.indexOf('**Seat 1**\nLeader 00') < body.indexOf('**Seat 8**\nLeader 07'));
  assert.equal(panels[0]!.footer, 'Drafted by <@100>');
});

test('a civ7 seat names its leaders and its civs', () => {
  const body = textOf(draftPanels({ choice: civ7, rules: null, questions: QUESTIONS, deal: deal(2, true), names: new Map(), by: '100' }));
  assert.match(body, /\*\*Seat 2\*\*\nLeaders: .+\nCivs: .+/);
  assert.match(body, /Civs: None/);
});

test('a long draft runs on into more posts, each within Discord\'s limit', () => {
  const panels = draftPanels({ choice: { ...civ6, drafts: 40 }, rules: null, questions: [], deal: deal(40), names: new Map(), by: '100' });
  assert.ok(panels.length > 1);
  assert.match(panels[1]!.title ?? '', /continued$/);
  assert.equal(panels[0]!.footer, undefined);
  for (const panel of panels) assert.ok(JSON.stringify(container(panel).toJSON()).length < LIMITS.text * 2);
  assert.match(textOf(panels), /\*\*Seat 40\*\*/);
});

test('the ban form fits the whole civ6 roster in four menus and keeps the rules', () => {
  const form = banForm(civ6, packChoice(civ6, QUESTIONS), data(89), civNamesOf(data(89)), 'Bring snacks').toJSON();
  assert.equal(form.components.length, 5);
  assert.ok(form.custom_id.length <= LIMITS.customId);
  assert.equal(JSON.stringify(form).includes('Bring snacks'), true);
});

test('civ7 bans offer only the civs of the starting age', () => {
  const rows = data(33, [{ token: 'CIV_A', age_pool: 'AGE_ANTIQUITY' }, { token: 'CIV_E', age_pool: 'AGE_EXPLORATION' }]);
  assert.deepEqual(banMenus(civ7, rows, new Map()).civs.flat().map((o) => o.token), ['CIV_A']);
  assert.equal(banMenus({ ...civ7, age: null }, rows, new Map()).civs.flat().length, 2);
  assert.equal(banMenus(civ7, rows, new Map()).leaders.length, 2);
});
