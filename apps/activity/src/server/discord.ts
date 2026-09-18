import { log } from './log.js';

export type DiscordApp = Readonly<{
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  guildId: string;
}>;

export type Member = Readonly<{ id: string; username: string; name: string; roles: readonly string[] }>;
export type Resolved =
  | { ok: true; member: Member }
  | { ok: false; reason: 'BAD_CODE' | 'NOT_A_MEMBER' | 'UNAVAILABLE' };

const TIMEOUT_MS = 8_000;

async function call(url: string, init: RequestInit): Promise<Response | null> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    log.warn('discord unreachable', url, error instanceof Error ? error.message : error);
    return null;
  }
}

// The SDK code, exchanged and resolved to a guild member in three calls.
// Membership is verified here and nowhere else; the token that comes out
// of the mint is only as trustworthy as this.
export async function resolveMember(app: DiscordApp, code: string): Promise<Resolved> {
  const exchange = await call(`${app.baseUrl}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: app.clientId,
      client_secret: app.clientSecret,
      grant_type: 'authorization_code',
      code,
    }),
  });
  if (!exchange) return { ok: false, reason: 'UNAVAILABLE' };
  if (!exchange.ok) return { ok: false, reason: 'BAD_CODE' };
  const { access_token: userToken } = (await exchange.json()) as { access_token?: string };
  if (!userToken) return { ok: false, reason: 'BAD_CODE' };

  const auth = { Authorization: `Bearer ${userToken}` };
  const me = await call(`${app.baseUrl}/users/@me`, { headers: auth });
  if (!me) return { ok: false, reason: 'UNAVAILABLE' };
  if (!me.ok) return { ok: false, reason: 'BAD_CODE' };
  const user = (await me.json()) as { id: string; username: string; global_name?: string | null };

  const membership = await call(`${app.baseUrl}/users/@me/guilds/${app.guildId}/member`, { headers: auth });
  if (!membership) return { ok: false, reason: 'UNAVAILABLE' };
  if (membership.status === 404) return { ok: false, reason: 'NOT_A_MEMBER' };
  if (!membership.ok) return { ok: false, reason: 'UNAVAILABLE' };
  const { roles, nick } = (await membership.json()) as { roles?: string[]; nick?: string | null };

  return { ok: true, member: { id: user.id, username: user.username, name: nick || user.global_name || user.username, roles: roles ?? [] } };
}
