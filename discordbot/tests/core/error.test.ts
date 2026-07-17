import { test } from 'node:test';
import assert from 'node:assert/strict';

import { errorMessage } from '../../src/core/errors.js';
import { ApiError } from '../../src/core/api/errors.js';

test('errorMessage: ApiError appends stringified body', () => {
  const e = new ApiError('HTTP 400', 400, { detail: 'bad match id' });
  assert.equal(errorMessage(e), 'HTTP 400: {"detail":"bad match id"}');
});

test('errorMessage: ApiError with string body appends it raw', () => {
  const e = new ApiError('HTTP 500', 500, 'upstream boom');
  assert.equal(errorMessage(e), 'HTTP 500: upstream boom');
});

test('errorMessage: ApiError with undefined body has no trailing colon', () => {
  const e = new ApiError('HTTP 404', 404);
  assert.equal(errorMessage(e), 'HTTP 404');
});

test('errorMessage: plain Error returns its message', () => {
  assert.equal(errorMessage(new Error('nope')), 'nope');
});

test('errorMessage: string passes through', () => {
  assert.equal(errorMessage('raw string'), 'raw string');
});

test('errorMessage: object with message string', () => {
  assert.equal(errorMessage({ message: 'objmsg' }), 'objmsg');
});

test('errorMessage: object with blank message falls through to Unknown', () => {
  assert.equal(errorMessage({ message: '   ' }), 'Unknown error');
});

test('errorMessage: unknown non-object -> Unknown error', () => {
  assert.equal(errorMessage(42), 'Unknown error');
  assert.equal(errorMessage(null), 'Unknown error');
});
