import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ComponentType } from 'discord.js';

import { container } from '../kit/index.js';
import { coinPanel, membersPanel, pingPanel, rollPanel, seedPanel } from './misc.js';

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

test('a full roll reads as a turn order, a partial one as the numbers drawn', () => {
  const order = rollPanel([3, 1, 2], 3, { label: 'Saturday FFA', userId: '100', channelId: null });
  assert.equal(order.title, 'Turn order for Saturday FFA');
  assert.match(JSON.stringify(order.body), /1\. \*\*3\*\*\\n2\. \*\*1\*\*/);
  assert.equal(order.footer, '<@100>');
  const picks = rollPanel([4, 5], 5);
  assert.equal(picks.title, 'Roll');
  assert.equal(picks.subtitle, '2 of 1\u20135, no repeats');
  assert.equal(picks.footer, undefined);
});

test('a ping says when the league server is not answering', () => {
  assert.equal(pingPanel(42, { ok: true, ms: 7 }).tone, 'success');
  const down = pingPanel(-1, { ok: false, ms: 10000 });
  assert.equal(down.tone, 'failed');
  assert.match(JSON.stringify(down.body), /not measured yet/);
  assert.match(JSON.stringify(down.body), /not answering after 10000 ms/);
});
