import type { IncomingMessage, ServerResponse } from 'node:http';

import { type DiscordApp, resolveMember } from './discord.js';
import { envelope } from './proxy.js';
import { mint } from './session.js';

export type SessionDeps = Readonly<{
  discord: DiscordApp;
  sessionSigningKey: string;
  staffRoleIds: readonly string[];
}>;

const LOBBY_ID = /^[0-9a-f]{24}$/;

const MAX_SESSION_BODY = 16 * 1024;

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_SESSION_BODY) {
        req.destroy();
        resolve(null);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null'));
      } catch {
        resolve(null);
      }
    });
    req.on('error', () => resolve(null));
  });
}

// Behind Caddy every connection is local, so the forwarded header is the
// client. A direct local call has none and falls back to the socket.
export function clientIp(req: IncomingMessage): string {
  const cf = req.headers['cf-connecting-ip'];
  if (typeof cf === 'string' && cf) return cf;
  const forwarded = req.headers['x-forwarded-for'];
  const chain = (Array.isArray(forwarded) ? forwarded.join(',') : forwarded) ?? '';
  const last = chain.split(',').map((s) => s.trim()).filter(Boolean).at(-1);
  return last || req.socket.remoteAddress || 'unknown';
}

// The SDK code becomes a session. Membership decides whether one is minted
// at all; the member's roles decide the staff claim, once, here.
export async function handleSession(
  deps: SessionDeps,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const body = (await readJson(req)) as { code?: unknown; lobby_id?: unknown } | null;
  const code = typeof body?.code === 'string' ? body.code : '';
  const lobbyId = typeof body?.lobby_id === 'string' ? body.lobby_id : undefined;
  if (!code || (lobbyId !== undefined && !LOBBY_ID.test(lobbyId))) {
    return envelope(res, 400, 'INVALID_REQUEST', false);
  }

  const resolved = await resolveMember(deps.discord, code);
  if (!resolved.ok) {
    if (resolved.reason === 'BAD_CODE') return envelope(res, 401, 'UNAUTHORIZED', false);
    if (resolved.reason === 'NOT_A_MEMBER') return envelope(res, 403, 'FORBIDDEN', false);
    return envelope(res, 503, 'UNAVAILABLE', true);
  }

  const { member } = resolved;
  const staff = member.roles.some((role) => deps.staffRoleIds.includes(role));
  const { token, expiresAt } = mint({ uid: member.id, name: member.name, gid: deps.discord.guildId, staff }, deps.sessionSigningKey);

  res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(
    JSON.stringify({
      token,
      expires_at: new Date(expiresAt).toISOString(),
      user: { id: member.id, username: member.username },
      ...(lobbyId ? { lobby_id: lobbyId } : {}),
    }),
  );
}
