import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ComponentType } from 'discord.js';

import { container } from '../kit/index.js';
import { coinPanel, membersPanel, seedPanel } from './misc.js';

/**
 * The small commands' panels. What should break this file: a seed that does
 * not copy as one token, or an export whose file is not shown on the panel.
 */

test('a coin flip states the side', () => {
  const json = container(coinPanel('tails')).toJSON();
  const all = JSON.stringify(json);
  assert.match(all, /It landed on \*\*tails\*\*\./);
});

test('a seed is one code span, with what it is for in the title and footer', () => {
  const panel = seedPanel('-123456', { label: 'Saturday FFA', userId: '100', channelId: '200' });
  assert.equal(panel.title, 'Map seed for Saturday FFA');
  assert.deepEqual(panel.body, [{ kind: 'text', text: '### `-123456`' }]);
  assert.equal(panel.footer, '<@100> \u00b7 <#200>');
  assert.equal(seedPanel('1').footer, undefined);
});

test('a member export shows its counts and its file', () => {
  const json = container(membersPanel({ total: 10, bots: 2 }, 'members.json', new Date(0))).toJSON();
  const fileBlock = json.components.find((c) => c.type === ComponentType.File);
  assert.ok(fileBlock && fileBlock.type === ComponentType.File);
  assert.equal(fileBlock.file.url, 'attachment://members.json');
  assert.match(JSON.stringify(json), /\*\*8\*\* people/);
});
