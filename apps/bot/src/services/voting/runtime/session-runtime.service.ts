import type { GameVoteSession } from '../../../types/voting.types.js';

const activeById = new Map<string, GameVoteSession>();
const activeByVoice = new Map<string, GameVoteSession>();
const reservedByVoice = new Set<string>();
const completedCleanupBySession = new Map<string, NodeJS.Timeout>();

export function getVoteVoiceKey(guildId: string, voiceChannelId: string): string {
  return `${guildId}:${voiceChannelId}`;
}

export function isVoteVoiceBusy(guildId: string, voiceChannelId: string): boolean {
  const key = getVoteVoiceKey(guildId, voiceChannelId);
  return activeByVoice.has(key) || reservedByVoice.has(key);
}

export function reserveVoteVoice(guildId: string, voiceChannelId: string): void {
  reservedByVoice.add(getVoteVoiceKey(guildId, voiceChannelId));
}

export function releaseReservedVoteVoice(guildId: string, voiceChannelId: string): void {
  reservedByVoice.delete(getVoteVoiceKey(guildId, voiceChannelId));
}

export function registerActiveVoteSession(session: GameVoteSession): void {
  activeById.set(session.sessionId, session);
  activeByVoice.set(getVoteVoiceKey(session.guildId, session.voiceChannelId), session);
}

export function getVoteSessionById(sessionId: string): GameVoteSession | null {
  return activeById.get(sessionId) ?? null;
}

export function clearCompletedVoteCleanup(sessionId: string): void {
  const timeout = completedCleanupBySession.get(sessionId);
  if (!timeout) return;
  clearTimeout(timeout);
  completedCleanupBySession.delete(sessionId);
}

export function scheduleCompletedVoteCleanup(session: GameVoteSession, retainForMs: number): void {
  clearCompletedVoteCleanup(session.sessionId);
  const timeout = setTimeout(() => {
    activeById.delete(session.sessionId);
    completedCleanupBySession.delete(session.sessionId);
  }, retainForMs);
  completedCleanupBySession.set(session.sessionId, timeout);
}

export function clearVoteSessionTimeout(session: GameVoteSession): void {
  if (!session.timeout) return;
  clearTimeout(session.timeout);
  session.timeout = null;
}

export function scheduleVoteSessionTimeout(session: GameVoteSession, onExpire: () => void, delayMs: number): void {
  clearVoteSessionTimeout(session);
  session.timeout = setTimeout(onExpire, delayMs);
}

export async function finalizeVoteSessionCleanup(session: GameVoteSession, retainCompletedForMs = 0): Promise<void> {
  clearVoteSessionTimeout(session);
  activeByVoice.delete(getVoteVoiceKey(session.guildId, session.voiceChannelId));

  if (retainCompletedForMs > 0) {
    scheduleCompletedVoteCleanup(session, retainCompletedForMs);
    return;
  }

  clearCompletedVoteCleanup(session.sessionId);
  activeById.delete(session.sessionId);
}
