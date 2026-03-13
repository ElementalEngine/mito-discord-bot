import type {
  SecretVoteChoice,
  SecretVoteSession,
  SecretVoteSessionPhase,
} from '../../../types/secretvote.types.js';

type SecretVoteSessionSeed = Readonly<{
  voteId: string;
  guildId: string;
  voiceChannelId: string;
  hostId: string;
  action: SecretVoteSession['action'];
  turn: number;
  details: string;
  voters: SecretVoteSession['voters'];
  startedAtMs: number;
  endsAtMs: number;
  dmMessages: SecretVoteSession['dmMessages'];
  publicMessage: SecretVoteSession['publicMessage'];
}>;

const activeByVoice = new Map<string, SecretVoteSession>();
const activeById = new Map<string, SecretVoteSession>();
const reservedByVoice = new Set<string>();

export function getSecretVoteVoiceKey(
  guildId: string,
  voiceChannelId: string
): string {
  return `${guildId}:${voiceChannelId}`;
}

export function isSecretVoteActive(voteId: string): boolean {
  return activeById.has(voteId);
}

export function getSecretVoteSession(
  voteId: string
): SecretVoteSession | null {
  return activeById.get(voteId) ?? null;
}

export function reserveSecretVoteVoice(
  guildId: string,
  voiceChannelId: string
): boolean {
  const key = getSecretVoteVoiceKey(guildId, voiceChannelId);
  if (reservedByVoice.has(key) || activeByVoice.has(key)) return false;
  reservedByVoice.add(key);
  return true;
}

export function releaseSecretVoteVoiceReservation(
  guildId: string,
  voiceChannelId: string
): void {
  reservedByVoice.delete(getSecretVoteVoiceKey(guildId, voiceChannelId));
}

export function createSecretVoteSession(
  seed: SecretVoteSessionSeed
): SecretVoteSession {
  return {
    ...seed,
    awaiting: new Set(seed.voters.map((v) => v.id)),
    votes: new Map(),
    timeout: null,
    editInFlight: false,
    needsRender: false,
    pendingStatus: null,
    phase: 'collecting',
  };
}

export function registerSecretVoteSession(session: SecretVoteSession): void {
  activeByVoice.set(
    getSecretVoteVoiceKey(session.guildId, session.voiceChannelId),
    session
  );
  activeById.set(session.voteId, session);
}

export function beginSecretVoteFinalization(
  session: SecretVoteSession
): boolean {
  if (session.phase !== 'collecting') return false;
  session.phase = 'finalizing';
  activeByVoice.delete(getSecretVoteVoiceKey(session.guildId, session.voiceChannelId));
  return true;
}

export function closeSecretVoteSession(session: SecretVoteSession): void {
  session.phase = 'closed';
  activeById.delete(session.voteId);
  activeByVoice.delete(getSecretVoteVoiceKey(session.guildId, session.voiceChannelId));
  reservedByVoice.delete(getSecretVoteVoiceKey(session.guildId, session.voiceChannelId));
}

export function isSecretVoteCollecting(
  session: SecretVoteSession
): boolean {
  return session.phase === 'collecting';
}

export function isSecretVoteVoter(
  session: SecretVoteSession,
  voterId: string
): boolean {
  return session.voters.some((voter) => voter.id === voterId);
}

export function hasSecretVoteVoted(
  session: SecretVoteSession,
  voterId: string
): boolean {
  return !session.awaiting.has(voterId);
}

export function recordSecretVoteInSession(
  session: SecretVoteSession,
  voterId: string,
  choice: SecretVoteChoice
): void {
  session.votes.set(voterId, choice);
  session.awaiting.delete(voterId);
}

export function getSecretVotePhase(
  session: SecretVoteSession
): SecretVoteSessionPhase {
  return session.phase;
}
