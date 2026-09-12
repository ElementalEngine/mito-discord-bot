// The proxy's whole surface: nine rows matching core-api's activity_router.
// Anything not here is 404, however valid it would be upstream.

const ID = '[0-9a-f]{24}';

type Row = Readonly<{ method: string; pattern: RegExp }>;

const rows: readonly Row[] = [
  { method: 'GET', pattern: /^\/api\/lobbies$/ },
  { method: 'GET', pattern: new RegExp(`^/api/lobbies/${ID}$`) },
  { method: 'PATCH', pattern: new RegExp(`^/api/lobbies/${ID}/seats$`) },
  { method: 'POST', pattern: new RegExp(`^/api/lobbies/${ID}/start$`) },
  { method: 'PUT', pattern: new RegExp(`^/api/lobbies/${ID}/votes$`) },
  { method: 'PUT', pattern: new RegExp(`^/api/lobbies/${ID}/bans$`) },
  { method: 'PUT', pattern: new RegExp(`^/api/lobbies/${ID}/picks$`) },
  { method: 'POST', pattern: new RegExp(`^/api/lobbies/${ID}/cancel$`) },
  { method: 'PUT', pattern: new RegExp(`^/api/lobbies/${ID}/ready$`) },
];

export const ROW_COUNT = rows.length;

// The upstream path for an allowed request, or null. /api/lobbies maps onto
// /api/v2/lobbies; the rest of the path is carried unchanged.
export function upstreamPath(method: string, pathname: string): string | null {
  const allowed = rows.some((row) => row.method === method && row.pattern.test(pathname));
  return allowed ? pathname.replace(/^\/api\/lobbies/, '/api/v2/lobbies') : null;
}
