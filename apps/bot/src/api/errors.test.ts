import { test } from "node:test";
import assert from "node:assert/strict";

import { ApiError, parseApiError } from "./errors.js";

const ENVELOPE = {
  code: "NOT_FOUND",
  message: "Match not found",
  details: null,
  retryable: false,
  correlation_id: "a1b2c3d4e5f6",
};

test("reads the shape core-api sends", () => {
  const parsed = parseApiError({ detail: { error: ENVELOPE } });
  assert.equal(parsed?.code, "NOT_FOUND");
  assert.equal(parsed?.retryable, false);
  assert.equal(parsed?.correlation_id, "a1b2c3d4e5f6");
});

test("reads the bare shape LadyJustice tolerates", () => {
  assert.equal(parseApiError({ error: ENVELOPE })?.code, "NOT_FOUND");
});

test("a v1 error is not an envelope", () => {
  // What Mite actually receives today: HTTPException(400, str(exc)).
  assert.equal(parseApiError({ detail: "Match id is not a valid ObjectId" }), null);
});

test("a half-envelope is treated as no envelope", () => {
  const { retryable: _r, ...noRetryable } = ENVELOPE;
  const { code: _c, ...noCode } = ENVELOPE;
  assert.equal(parseApiError({ detail: { error: noRetryable } }), null);
  assert.equal(parseApiError({ detail: { error: noCode } }), null);
});

test("junk bodies do not throw", () => {
  for (const body of [null, undefined, "", "plain text", 42, [], {}]) {
    assert.equal(parseApiError(body), null);
  }
});

test("ApiError exposes code and retryable from an envelope", () => {
  const err = new ApiError("HTTP 503", 503, {
    detail: { error: { ...ENVELOPE, code: "UNAVAILABLE", retryable: true } },
  });
  assert.equal(err.code, "UNAVAILABLE");
  assert.equal(err.retryable, true);
});

test("ApiError leaves them undefined when there is no envelope", () => {
  const err = new ApiError("HTTP 400", 400, { detail: "bad id" });
  assert.equal(err.code, undefined);
  assert.equal(err.retryable, undefined);
  assert.equal(err.status, 400);
});
