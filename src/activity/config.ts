import { config } from '../core/config/index.js';

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
  port: readPort(),
  identityTtlSeconds: IDENTITY_TTL_SECONDS,
  roomAccessTtlSeconds: ROOM_ACCESS_TTL_SECONDS,
  devTokenEndpointEnabled: config.env !== 'production' && process.env.ACTIVITY_DEV_TOKENS === '1',
  publicUrl: (process.env.ACTIVITY_PUBLIC_URL ?? '').trim().replace(/\/+$/, ''),
  devGuildIds: (process.env.ACTIVITY_DEV_GUILD_IDS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0),
} as const;


export function validateActivityConfig(): void {
  const secret = activityConfig.sessionSecret.trim();
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `ACTIVITY_SESSION_SECRET must be set and at least ${MIN_SECRET_LENGTH} characters ` +
        `(generate with: openssl rand -base64 32). Refusing to start the activity server.`,
    );
  }
}
