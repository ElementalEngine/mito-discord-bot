// The payload is readable; only the server decides whether it is valid.
// Used to mark "your" seat and the host controls, never for authorisation.
export type Me = { uid: string; staff: boolean };

export function whoami(token: string | null): Me | null {
  const payload = token?.split('.')[2];
  if (!payload) return null;
  try {
    const claims = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as Partial<Me>;
    return typeof claims.uid === 'string' ? { uid: claims.uid, staff: claims.staff === true } : null;
  } catch {
    return null;
  }
}
