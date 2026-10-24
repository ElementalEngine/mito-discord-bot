import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ApiError } from '../api/errors.js';
import { Refusal, failureOf } from './reply.js';

const envelope = (code: string, message: string, retryable: boolean, correlation_id?: string) => ({
  detail: { error: { code, message, retryable, ...(correlation_id ? { correlation_id } : {}) } },
});

test('a refusal is said back as written and not logged', () => {
  assert.deepEqual(failureOf(new Refusal('You do not host this lobby.'), 'cancel the lobby'), {
    tone: 'refused',
    text: 'You do not host this lobby.',
    level: 'none',
    incident: null,
  });
});

test('core-api refusing shows its message, not its body', () => {
  const error = new ApiError('HTTP 400', 400, envelope('INVALID_REQUEST', 'Seat 3 has no placement.', false));
  const out = failureOf(error, 'approve the report');
  assert.equal(out.tone, 'refused');
  assert.equal(out.level, 'warn');
  assert.equal(out.text, 'Could not approve the report: Seat 3 has no placement.');
  assert.doesNotMatch(out.text, /detail|INVALID_REQUEST|\{/);
});

test('a retryable server failure says to try again and carries its ref', () => {
  const error = new ApiError('HTTP 500', 500, envelope('INTERNAL', 'Internal error', true, 'c0ffee'));
  const out = failureOf(error, 'load stats');
  assert.equal(out.tone, 'failed');
  assert.equal(out.level, 'error');
  assert.equal(out.text, 'Could not load stats: Internal error. Try again. (ref c0ffee)');
});

test('a failure with no envelope names the status only', () => {
  const out = failureOf(new ApiError('HTTP 404', 404, '<html>secret</html>'), 'find the match');
  assert.equal(out.text, 'Could not find the match: refused (404).');
  assert.doesNotMatch(out.text, /html|secret/);
});

test('a timeout or dropped connection says the server did not answer', () => {
  const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
  assert.match(failureOf(abort, 'load stats').text, /did not answer/);
  assert.match(failureOf(new TypeError('fetch failed'), 'load stats').text, /did not answer/);
});

test('a bug is shown with an incident id and logged as an error', () => {
  const out = failureOf(new TypeError("Cannot read properties of undefined (reading 'x')"), 'open the lobby');
  assert.equal(out.level, 'error');
  assert.match(out.incident ?? '', /^[0-9a-f]{6}$/);
  assert.equal(out.text, `Could not open the lobby. Ref ${out.incident}.`);
  assert.doesNotMatch(out.text, /undefined|properties/);
});
