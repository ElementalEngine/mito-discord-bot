import type { SecretVoteSession } from '../../../types/secretvote.types.js';

export const SECRET_VOTE_DURATION_MS = 2 * 60_000;
export const SECRET_VOTE_DURATION_LABEL = '2 minutes';

export function createSecretVoteDeadlineWindow(
  startedAtMs: number = Date.now()
): Readonly<{ startedAtMs: number; endsAtMs: number }> {
  return {
    startedAtMs,
    endsAtMs: startedAtMs + SECRET_VOTE_DURATION_MS,
  };
}

export function clearSecretVoteTimeout(session: SecretVoteSession): void {
  if (!session.timeout) return;
  clearTimeout(session.timeout);
  session.timeout = null;
}

export function scheduleSecretVoteTimeout(
  session: SecretVoteSession,
  callback: () => void
): void {
  clearSecretVoteTimeout(session);
  session.timeout = setTimeout(
    callback,
    Math.max(0, session.endsAtMs - Date.now())
  );
}
