import { test } from 'node:test';
import assert from 'node:assert/strict';

import { LIMITS, componentCount, container, customId, fit, parseId, text, withinTextLimit } from './index.js';

test('fit cuts with an ellipsis and leaves short text alone', () => {
  assert.equal(fit('abcdef', 4), 'abc\u2026');
  assert.equal(fit('abc', 4), 'abc');
  assert.equal(fit('abc', 0), '');
});

test('a custom id round-trips and refuses what would break parsing', () => {
  const id = customId('lobby', 'open', '652f1a2b3c4d5e6f7a8b9c0d');
  assert.equal(id, 'lobby:open:652f1a2b3c4d5e6f7a8b9c0d');
  assert.deepEqual(parseId(id), { surface: 'lobby', verb: 'open', args: ['652f1a2b3c4d5e6f7a8b9c0d'] });
  assert.throws(() => customId('report', 'set:order'));
  assert.throws(() => customId('report', 'x', 'a'.repeat(LIMITS.customId)));
  assert.equal(parseId('lobby'), null);
});

test('text over Discord\u2019s total is trimmed from the longest block', () => {
  const blocks = withinTextLimit([text('a'.repeat(3000)), text('b'.repeat(3000))], 4000);
  const total = blocks.reduce((n, b) => n + ('text' in b ? b.text.length : 0), 0);
  assert.ok(total <= 4000);
});

test('a panel over 40 components is refused before Discord sees it', () => {
  const body = Array.from({ length: 40 }, () => text('x'));
  assert.equal(componentCount(body), 41);
  assert.throws(() => container({ tone: 'info', body }), /components/);
  assert.doesNotThrow(() => container({ tone: 'info', body: body.slice(0, 39) }));
});
