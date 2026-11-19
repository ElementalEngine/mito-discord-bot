import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isOutsider, unwatchReactions, watchReactions } from './reactions.js';

const count = async (): Promise<void> => undefined;

test('a member not voting is an outsider on a watched message', () => {
  watchReactions('setup-1', 'msg-1', count, new Set(['111', '222']));
  assert.equal(isOutsider('msg-1', '333'), true);
  assert.equal(isOutsider('msg-1', '111'), false);
  unwatchReactions(['msg-1']);
});

test('nobody is an outsider on a message no vote watches', () => {
  assert.equal(isOutsider('msg-unwatched', '333'), false);
  watchReactions('setup-2', 'msg-2', count, new Set(['111']));
  unwatchReactions(['msg-2']);
  assert.equal(isOutsider('msg-2', '333'), false);
});

test('every message of a setup shares its voters', () => {
  const voters = new Set(['111']);
  watchReactions('setup-3', 'msg-3a', count, voters);
  watchReactions('setup-3', 'msg-3b', count, voters);
  assert.equal(isOutsider('msg-3b', '111'), false);
  assert.equal(isOutsider('msg-3b', '222'), true);
  unwatchReactions(['msg-3a', 'msg-3b']);
});
