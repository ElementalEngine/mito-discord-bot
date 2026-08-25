import { test } from "node:test";
import assert from "node:assert/strict";

import { ApiClient } from "./client.js";
import { ApiError } from "./errors.js";

/**
 * D93's retry rule. Fifteen of this client's nineteen calls are PUTs that
 * approve, revert or mutate a match, so the question these tests answer is
 * not "does it retry" but "does it decline to retry a write whose outcome
 * we never learned".
 *
 * What should break this file: retrying a transport failure on anything
 * but GET, or ignoring an envelope that says retryable false.
 */

const envelope = (code: string, retryable: boolean) => ({
  detail: { error: { code, message: "", retryable } },
});

// shouldRetry is private; the rule is what is under test, not the access.
const decide = (client: ApiClient, err: unknown, method: string): boolean =>
  (client as unknown as { shouldRetry(e: unknown, m: string): boolean }).shouldRetry(err, method);

const client = new ApiClient("http://localhost", fetch, "token");

test("an envelope saying retryable false is never retried, on any method", () => {
  const err = new ApiError("HTTP 503", 503, envelope("UNAVAILABLE", false));
  for (const method of ["GET", "PUT", "POST"]) {
    assert.equal(decide(client, err, method), false);
  }
});

test("an envelope saying retryable true is retried, even on a write", () => {
  // The server answered and chose not to act, so the write did not land.
  const err = new ApiError("HTTP 503", 503, envelope("UNAVAILABLE", true));
  assert.equal(decide(client, err, "PUT"), true);
});

test("a transport failure is retried on GET only", () => {
  const err = new Error("terminated");
  assert.equal(decide(client, err, "GET"), true);
  assert.equal(decide(client, err, "PUT"), false);
  assert.equal(decide(client, err, "POST"), false);
});

test("an unenveloped 5xx follows the transport rule", () => {
  // v1 today: HTTPException with a bare string, no retryable to honour.
  const err = new ApiError("HTTP 500", 500, { detail: "boom" });
  assert.equal(decide(client, err, "GET"), true);
  assert.equal(decide(client, err, "PUT"), false);
});

test("a 4xx is never retried, envelope or not", () => {
  const err = new ApiError("HTTP 400", 400, { detail: "bad id" });
  assert.equal(decide(client, err, "GET"), false);
  assert.equal(decide(client, err, "PUT"), false);
});
