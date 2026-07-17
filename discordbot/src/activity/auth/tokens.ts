import { createHmac, timingSafeEqual } from 'node:crypto';

const TOKEN_VERSION = 'v1';
const IDENTITY_TYP = 'identity' as const;
const ROOM_ACCESS_TYP = 'room-access' as const;

/** iat may be at most this many seconds in the future (clock-skew tolerance). */
const CLOCK_SKEW_TOLERANCE_SECONDS = 30;

export interface IdentityClaims {
  typ: typeof IDENTITY_TYP;
  /** Discord user id. */
  sub: string;
  /** Display name (optional; presentation only). */
  name?: string;
  /** True → this user is an authenticated staff observer (god-view when unseated). */
  staff?: boolean;
  /** Issued-at (epoch seconds). */
  iat: number;
  /** Expiry (epoch seconds). */
  exp: number;
}

export interface RoomAccessClaims {
  typ: typeof ROOM_ACCESS_TYP;
  /** Discord user id this grant is bound to. */
  sub: string;
  /** Session id this grant is bound to. */
  sessionId: string;
  /** Issued-at (epoch seconds). */
  iat: number;
  /** Expiry (epoch seconds). */
  exp: number;
}

export type TokenFailure =
  | 'no-secret'
  | 'malformed'
  | 'bad-version'
  | 'bad-signature'
  | 'bad-payload'
  | 'wrong-type'
  | 'expired'
  | 'not-yet-valid'
  | 'binding-mismatch';

export type VerifyResult<T> = { ok: true; claims: T } | { ok: false; reason: TokenFailure };

// ── Signing ──────────────────────────────────────────────────────────────────

/** Mint an identity token (proves *who* the Discord user is). */
export function createIdentityToken(
  secret: string,
  identity: { userId: string; name?: string; staff?: boolean },
  options: { ttlSeconds: number; nowMs?: number },
): string {
  const nowSeconds = toSeconds(options.nowMs ?? Date.now());
  const claims: IdentityClaims = {
    typ: IDENTITY_TYP,
    sub: identity.userId,
    ...(identity.name !== undefined ? { name: identity.name } : {}),
    ...(identity.staff ? { staff: true } : {}),
    iat: nowSeconds,
    exp: nowSeconds + options.ttlSeconds,
  };
  return sign(secret, claims);
}

/** Mint a room-access token (proves this user may enter this session). */
export function createRoomAccessToken(
  secret: string,
  access: { userId: string; sessionId: string },
  options: { ttlSeconds: number; nowMs?: number },
): string {
  const nowSeconds = toSeconds(options.nowMs ?? Date.now());
  const claims: RoomAccessClaims = {
    typ: ROOM_ACCESS_TYP,
    sub: access.userId,
    sessionId: access.sessionId,
    iat: nowSeconds,
    exp: nowSeconds + options.ttlSeconds,
  };
  return sign(secret, claims);
}

// ── Verifying ────────────────────────────────────────────────────────────────

export function verifyIdentityToken(
  secret: string | undefined,
  token: string | null | undefined,
  options?: { nowMs?: number },
): VerifyResult<IdentityClaims> {
  const parsed = verifyEnvelope(secret, token);
  if (!parsed.ok) return parsed;

  const claims = parsed.value;
  if (!isIdentityClaims(claims)) return fail('wrong-type');

  const timing = checkTiming(claims.iat, claims.exp, options?.nowMs);
  if (timing) return fail(timing);

  return { ok: true, claims };
}

export function verifyRoomAccessToken(
  secret: string | undefined,
  token: string | null | undefined,
  expected: { userId: string; sessionId: string },
  options?: { nowMs?: number },
): VerifyResult<RoomAccessClaims> {
  const parsed = verifyEnvelope(secret, token);
  if (!parsed.ok) return parsed;

  const claims = parsed.value;
  if (!isRoomAccessClaims(claims)) return fail('wrong-type');

  const timing = checkTiming(claims.iat, claims.exp, options?.nowMs);
  if (timing) return fail(timing);

  // Bind the grant to the caller's identity + session.
  if (claims.sub !== expected.userId || claims.sessionId !== expected.sessionId) {
    return fail('binding-mismatch');
  }

  return { ok: true, claims };
}

// ── Internals ────────────────────────────────────────────────────────────────

function sign(secret: string, claims: IdentityClaims | RoomAccessClaims): string {
  const payload = toBase64Url(Buffer.from(JSON.stringify(claims), 'utf8'));
  const signature = toBase64Url(hmac(secret, `${TOKEN_VERSION}.${payload}`));
  return `${TOKEN_VERSION}.${payload}.${signature}`;
}

function verifyEnvelope(
  secret: string | undefined,
  token: string | null | undefined,
): { ok: true; value: unknown } | { ok: false; reason: TokenFailure } {
  const normalizedSecret = secret?.trim() ?? '';
  if (normalizedSecret.length === 0) return fail('no-secret');
  if (!token) return fail('malformed');

  const parts = token.split('.');
  if (parts.length !== 3) return fail('malformed');
  const [version, payload, signature] = parts;
  if (!version || !payload || !signature) return fail('malformed');
  if (version !== TOKEN_VERSION) return fail('bad-version');

  const expectedSignature = toBase64Url(hmac(normalizedSecret, `${version}.${payload}`));
  if (!constantTimeStringEquals(signature, expectedSignature)) return fail('bad-signature');

  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(fromBase64Url(payload)).toString('utf8'));
  } catch {
    return fail('bad-payload');
  }
  return { ok: true, value };
}

/** Returns a failure reason string if timing is invalid, else null. */
function checkTiming(iat: number, exp: number, nowMs: number | undefined): TokenFailure | null {
  const nowSeconds = toSeconds(nowMs ?? Date.now());
  if (exp <= nowSeconds) return 'expired';
  if (iat > nowSeconds + CLOCK_SKEW_TOLERANCE_SECONDS) return 'not-yet-valid';
  return null;
}

function hmac(secret: string, value: string): Buffer {
  return createHmac('sha256', secret).update(value, 'utf8').digest();
}

/** Length-safe, timing-safe compare of two base64url signature strings. */
function constantTimeStringEquals(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, 'utf8');
  const rightBytes = Buffer.from(right, 'utf8');
  if (leftBytes.length !== rightBytes.length) return false;
  return timingSafeEqual(leftBytes, rightBytes);
}

function toSeconds(ms: number): number {
  return Math.floor(ms / 1000);
}

function fail(reason: TokenFailure): { ok: false; reason: TokenFailure } {
  return { ok: false, reason };
}

function isIdentityClaims(value: unknown): value is IdentityClaims {
  if (!isRecord(value)) return false;
  if (value.typ !== IDENTITY_TYP) return false;
  if (!isNonEmptyString(value.sub)) return false;
  if (value.name !== undefined && typeof value.name !== 'string') return false;
  if (value.staff !== undefined && typeof value.staff !== 'boolean') return false;
  return isFiniteNumber(value.iat) && isFiniteNumber(value.exp);
}

function isRoomAccessClaims(value: unknown): value is RoomAccessClaims {
  if (!isRecord(value)) return false;
  if (value.typ !== ROOM_ACCESS_TYP) return false;
  if (!isNonEmptyString(value.sub)) return false;
  if (!isNonEmptyString(value.sessionId)) return false;
  return isFiniteNumber(value.iat) && isFiniteNumber(value.exp);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function toBase64Url(bytes: Buffer): string {
  return bytes.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(value: string): Buffer {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + padding, 'base64');
}
