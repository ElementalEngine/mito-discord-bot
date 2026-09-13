import { createHmac, timingSafeEqual } from 'node:crypto';

// act.v1.<base64url(payload)>.<sig>, HMAC-SHA256, eight hours.
export const TTL_MS = 8 * 60 * 60 * 1000;
const PREFIX = 'act.v1';

export type Claims = Readonly<{
  uid: string;
  name?: string;
  gid: string;
  staff: boolean;
  iat: number;
  exp: number;
}>;

export type VerifyFailure = 'MALFORMED' | 'BAD_SIGNATURE' | 'EXPIRED' | 'BAD_PAYLOAD';
export type Verified = { ok: true; claims: Claims } | { ok: false; reason: VerifyFailure };

function sign(payload: string, key: string): string {
  return createHmac('sha256', key).update(payload).digest('base64url');
}

export function mint(
  who: Pick<Claims, 'uid' | 'name' | 'gid' | 'staff'>,
  key: string,
  now = Date.now(),
): { token: string; expiresAt: number } {
  const claims: Claims = { ...who, iat: now, exp: now + TTL_MS };
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return { token: `${PREFIX}.${payload}.${sign(payload, key)}`, expiresAt: claims.exp };
}

// Signature first, over the raw payload; expiry second; the fields are
// trusted only after both. A tampered token never reaches JSON.parse.
export function verify(token: string, key: string, now = Date.now()): Verified {
  const parts = token.split('.');
  if (parts.length !== 4 || `${parts[0]}.${parts[1]}` !== PREFIX) {
    return { ok: false, reason: 'MALFORMED' };
  }
  const [, , payload, sig] = parts;
  const expected = Buffer.from(sign(payload, key));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return { ok: false, reason: 'BAD_SIGNATURE' };
  }
  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'BAD_PAYLOAD' };
  }
  if (!isClaims(claims)) return { ok: false, reason: 'BAD_PAYLOAD' };
  if (claims.exp <= now) return { ok: false, reason: 'EXPIRED' };
  return { ok: true, claims };
}

function isClaims(value: unknown): value is Claims {
  if (typeof value !== 'object' || value === null) return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.uid === 'string' &&
    typeof c.gid === 'string' &&
    typeof c.staff === 'boolean' &&
    typeof c.iat === 'number' &&
    typeof c.exp === 'number'
  );
}
