import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { CivDataResponse, DraftDeal } from '../../api/types.js';
import type { PostAbout } from '../../utils/post-options.js';
import { civNamesOf, container, LIMITS, parseId } from '../kit/index.js';
import { banForm, banMenus, draftPanels, draftRequest, packChoice, unpackChoice, unpackForm, type DraftChoice } from './draft.js';

const civ6: DraftChoice = { edition: 'civ6', mode: 'ffa', drafts: 8, leaders: 3, civs: null, age: null };
const civ7: DraftChoice = { edition: 'civ7', mode: 'teamer', drafts: 2, leaders: 4, civs: 3, age: 'AGE_ANTIQUITY' };
const nobody: PostAbout = { label: '', userId: null, channelId: null };

const pad = (i: number): string => String(i).padStart(2, '0');
const leaders = (n: number) => Array.from({ length: n }, (_, i) => ({ token: `LEADER_${pad(i)}`, name: `L${i}`, display: `Leader ${pad(i)}` }));
const data = (leaderCount: number, civs: { token: string; age_pool: string }[] = []) =>
  ({ edition: 'civ7', leader_data_version: 1, leaders: leaders(leaderCount), civs: civs.map((c) => ({ ...c, name: c.token, display: c.token })) }) as unknown as CivDataResponse;

// Each draft deals its own leaders, two at a time, in order.
const deal = (drafts: number, civs = false): DraftDeal => ({
  pools: Array.from({ length: drafts }, (_, i) => ({ leaders: [`LEADER_${pad(2 * i)}`, `LEADER_${pad(2 * i + 1)}`], civs: civs ? ['CIV_A', 'CIV_B'] : [] })),
  bans: { leader: [], civ: [] },
});

test('a choice survives its trip through a form id', () => {
  for (const choice of [civ6, civ7, { ...civ7, age: null }, { ...civ6, mode: 'duel', drafts: 2 } as DraftChoice]) {
    assert.deepEqual(unpackChoice(packChoice(choice)), choice);
  }
  assert.equal(unpackChoice('not a draft'), null);
});

test('the deal asks core-api for exactly what the host chose', () => {
  const none = { leaders: [], civs: [] };
  assert.deepEqual(draftRequest(civ6, { leaders: ['LEADER_00'], civs: [] }, '100'), {
    host_id: '100', edition: 'civ6', game_type: 'ffa', drafts: 8, leaders: 3, civs: null, starting_age: null, leader_bans: ['LEADER_00'], civ_bans: [],
  });
  assert.equal(draftRequest(civ7, { leaders: [], civs: ['CIV_A'] }, '100').starting_age, 'AGE_ANTIQUITY');
  assert.equal(draftRequest(civ7, none, '100').civs, 3);
});

test('every draft message stays well within Discord\'s limit', () => {
  const panels = draftPanels({ choice: { ...civ6, drafts: 14 }, deal: deal(14), names: civNamesOf(data(28)), by: '100', about: nobody });
  assert.equal(panels.length, 15);
  for (const panel of panels) assert.ok(JSON.stringify(container(panel).toJSON()).length < LIMITS.text);
});

test('the ban form fits the whole civ6 roster in four menus, then the label', () => {
  const form = banForm(civ6, nobody, data(89), civNamesOf(data(89))).toJSON();
  assert.equal(form.components.length, 5);
});

test('the ban form keeps who and where the draft is for', () => {
  const about = { label: 'Game 3', userId: '123456789012345678', channelId: '876543210987654321' };
  const form = banForm(civ7, about, data(38), new Map()).toJSON();
  assert.ok(form.custom_id.length <= LIMITS.customId);
  assert.equal((form.components.at(-1) as unknown as { component: { value?: string } }).component.value, 'Game 3');
  assert.deepEqual(unpackForm(parseId(form.custom_id)!.args, ' Game 3 '), { choice: civ7, about });
  const plain = banForm(civ6, nobody, data(8), new Map()).toJSON();
  assert.deepEqual(unpackForm(parseId(plain.custom_id)!.args, ''), { choice: civ6, about: nobody });
  assert.equal(unpackForm(['not a draft'], ''), null);
});

test('civ7 bans offer only the civs of the starting age', () => {
  const rows = data(33, [{ token: 'CIV_A', age_pool: 'AGE_ANTIQUITY' }, { token: 'CIV_E', age_pool: 'AGE_EXPLORATION' }]);
  assert.deepEqual(banMenus(civ7, rows, new Map()).civs.flat().map((o) => o.token), ['CIV_A']);
  assert.equal(banMenus({ ...civ7, age: null }, rows, new Map()).civs.flat().length, 2);
  assert.equal(banMenus(civ7, rows, new Map()).leaders.length, 2);
});
