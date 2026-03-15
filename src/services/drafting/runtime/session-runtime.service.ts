import type {
  ButtonInteraction,
  StringSelectMenuInteraction,
} from 'discord.js';

import { replyDraftNotice } from './message-ops.service.js';

type DraftSessionInteraction = ButtonInteraction | StringSelectMenuInteraction;

type TimeoutTrackedSession = {
  timeout: NodeJS.Timeout | null;
};

type ActiveSession = TimeoutTrackedSession & {
  sessionId: string;
};

export function getActiveInteractiveDraftSession<T>(
  sessions: ReadonlyMap<string, T>,
  sessionId: string,
): T | null {
  return sessions.get(sessionId) ?? null;
}

export async function requireActiveInteractiveDraftSession<T>(
  interaction: DraftSessionInteraction,
  sessions: ReadonlyMap<string, T>,
  sessionId: string,
  inactiveMessage: string,
): Promise<T | null> {
  const session = getActiveInteractiveDraftSession(sessions, sessionId);
  if (session) return session;

  await replyDraftNotice(interaction, inactiveMessage);
  return null;
}

export function clearInteractiveSessionTimeout(
  session: TimeoutTrackedSession,
): void {
  if (!session.timeout) return;
  clearTimeout(session.timeout);
  session.timeout = null;
}

export function scheduleInteractiveSessionTimeout(
  session: TimeoutTrackedSession,
  delayMs: number,
  callback: () => void,
): void {
  clearInteractiveSessionTimeout(session);
  session.timeout = setTimeout(callback, delayMs);
}

export async function closeInteractiveDraftSession<T extends ActiveSession>(
  sessions: Map<string, T>,
  session: T,
  onClose?: () => Promise<void> | void,
): Promise<void> {
  if (!sessions.has(session.sessionId)) return;
  clearInteractiveSessionTimeout(session);
  try {
    if (onClose) {
      await onClose();
    }
  } finally {
    sessions.delete(session.sessionId);
  }
}

export function isStaleDraftTurnToken(
  currentTurnToken: number,
  interactionTurnToken: number,
): boolean {
  return currentTurnToken !== interactionTurnToken;
}
