import { config } from '../core/config/index.js';

/**
 * Activity transport config (R6.1).
 *
 * Reads its own dedicated signing secret — NEVER a service token. Kept in the
 * activity zone (not core/config) so the transport owns its surface and the
 * secret has one consumer. `validateActivityConfig()` is called by the server at
 * startup (R6.2): a missing/short secret fails LOUD there, rather than silently
 * rejecting every connection with a 4403.
 */

const MIN_SECRET_LENGTH = 32;

/** Default bind port; overridable via ACTIVITY_PORT. Bound to 127.0.0.1 — Caddy is the only ingress. */
const DEFAULT_ACTIVITY_PORT = 8080;

/** Identity token lifetime (matches civup's 8h Activity session). */
const IDENTITY_TTL_SECONDS = 8 * 60 * 60;
/** Room-access token lifetime. */
const ROOM_ACCESS_TTL_SECONDS = 8 * 60 * 60;

function readPort(): number {
  const raw = process.env.ACTIVITY_PORT?.trim();
  if (!raw) return DEFAULT_ACTIVITY_PORT;
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 && parsed < 65_536 ? parsed : DEFAULT_ACTIVITY_PORT;
}

export const activityConfig = {
  /** HMAC signing secret for both activity tokens. */
  sessionSecret: process.env.ACTIVITY_SESSION_SECRET ?? '',
  /** Bind port (loopback only). */
  port: readPort(),
  identityTtlSeconds: IDENTITY_TTL_SECONDS,
  roomAccessTtlSeconds: ROOM_ACCESS_TTL_SECONDS,
  /** Dev-only test-token endpoint gate (R6.3). Off unless explicitly enabled. */
  devTokenEndpointEnabled: config.env !== 'production' && process.env.ACTIVITY_DEV_TOKENS === '1',
} as const;

/**
 * Throw if the activity transport is not safely configured. Call once at server
 * startup (R6.2), before binding. Never called at import time — importing the
 * module (e.g. for the token unit tests) must not require a secret.
 */
export function validateActivityConfig(): void {
  const secret = activityConfig.sessionSecret.trim();
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `ACTIVITY_SESSION_SECRET must be set and at least ${MIN_SECRET_LENGTH} characters ` +
        `(generate with: openssl rand -base64 32). Refusing to start the activity server.`,
    );
  }
}
