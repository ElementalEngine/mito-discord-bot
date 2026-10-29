import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { ChatInputCommandInteraction } from 'discord.js';

import { castIn, closeSecretVote, openSecretVote, resultOf, type Action, type Choice } from './secret-vote.js';

const voters = (n: number): string[] => Array.from({ length: n }, (_, i) => String(i));
const noFrom = (n: number): Map<string, Choice> => new Map(voters(n).map((v): [string, Choice] => [v, 'no']));

// Action, turn, YES, NO, passed: each side of every turn band's rule.
const CASES: readonly (readonly [Action, number, number, number, boolean])[] = [
  ['CC', 80, 7, 0, true],
  ['CC', 80, 7, 1, false],
  ['CC', 81, 7, 1, true],
  ['CC', 100, 6, 2, false],
  ['CC', 101, 6, 2, true],
  ['CC', 101, 5, 3, false],
  ['Scrap', 20, 4, 2, true],
  ['Scrap', 20, 3, 2, false],
  ['Scrap', 21, 6, 2, true],
  ['Scrap', 50, 5, 2, false],
  ['Scrap', 51, 6, 1, true],
  ['Scrap', 71, 6, 1, false],
  ['Irrel', 49, 5, 1, false],
  ['Irrel', 50, 5, 2, true],
  ['Irrel', 50, 5, 3, false],
  ['Remap', 10, 6, 0, true],
  ['Remap', 10, 6, 1, false],
];

test('each action passes by its rule for the turn', () => {
  for (const [action, turn, yes, no, passed] of CASES) {
    assert.equal(resultOf({ action, turn, voters: voters(yes + no), choices: noFrom(no) }).passed, passed, `${action} turn ${turn}: ${yes} YES, ${no} NO`);
  }
});

test('a voter with no choice counts as YES', () => {
  const result = resultOf({ action: 'CC', turn: 90, voters: ['a', 'b', 'c'], choices: new Map<string, Choice>([['a', 'no']]) });
  assert.deepEqual(result, { yes: 2, no: 1, passed: true, silent: ['b', 'c'] });
});

test('one vote per voice channel, one choice per voter, none once closed', () => {
  const reply = {} as ChatInputCommandInteraction;
  const vote = { action: 'CC', turn: 5, details: 'd', hostId: 'h', voiceId: 'v', voters: ['a', 'b'], reply } as const;
  openSecretVote({ ...vote, id: '1' });
  assert.throws(() => openSecretVote({ ...vote, id: '2' }), /already running/);
  assert.equal(castIn('1', 'a', 'yes').choices.get('a'), 'yes');
  assert.throws(() => castIn('1', 'a', 'no'), /already in/);
  assert.throws(() => castIn('1', 'x', 'no'), /Only the players/);
  assert.equal(closeSecretVote('1')?.id, '1');
  assert.equal(closeSecretVote('1'), undefined);
  assert.throws(() => castIn('1', 'b', 'no'), /has closed/);
  assert.equal(openSecretVote({ ...vote, id: '3' }).id, '3');
  closeSecretVote('3');
});
