// Dev only: a session minted by hand and passed as ?token=. Vite compiles
// the whole branch out of a production build.
export function devToken(location: Location): string | null {
  if (!import.meta.env.DEV) return null;
  return new URLSearchParams(location.search).get('token');
}
