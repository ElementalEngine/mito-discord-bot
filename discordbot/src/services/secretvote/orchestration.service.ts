import { randomUUID } from 'node:crypto';

import { EMOJI_ERROR, EMOJI_FAIL } from '../../config/constants.js';
import type {
  SecretVoteChoice,
  StartSecretVoteOptions,
  StartSecretVoteResult,
} from '../../types/secretvote.types.js';
import {
  createSecretVoteDeadlineWindow,
  clearSecretVoteTimeout,
  isSecretVoteWithinAcceptanceWindow,
  scheduleSecretVoteTimeout,
} from './runtime/deadline.service.js';
import {
  buildInitialSecretVoteStatus,
  buildSecretVoteStatus,
  disableSecretVoteDmButtons,
  notifySecretVoteTimedOutVoters,
  requestSecretVotePublicRender,
  rollbackSecretVoteDmMessages,
  sendSecretVoteDmPrompts,
  sendSecretVotePublicMessage,
} from './runtime/message-ops.service.js';
import {
  beginSecretVoteFinalization,
  closeSecretVoteSession,
  createSecretVoteSession,
  getSecretVoteSession,
  hasSecretVoteVoted,
  isSecretVoteActive,
  isSecretVoteCollecting,
  isSecretVoteVoter,
  recordSecretVoteInSession,
  registerSecretVoteSession,
  releaseSecretVoteVoiceReservation,
  reserveSecretVoteVoice,
} from './runtime/session-runtime.service.js';
import { evaluateSecretVoteOutcome } from './domain/rules.service.js';

export type RecordSecretVoteResult =
  | Readonly<{ ok: false; kind: 'NOT_ACTIVE'; message: string }>
  | Readonly<{ ok: false; kind: 'ALREADY_VOTED'; message: string }>
  | Readonly<{ ok: false; kind: 'NOT_ELIGIBLE'; message: string }>
  | Readonly<{
      ok: true;
      kind: 'RECORDED';
      isComplete: boolean;
      choice: SecretVoteChoice;
    }>;


async function safeDeletePublicSecretVoteMessage(
  publicMessage: { delete: () => Promise<unknown> } | null | undefined
): Promise<void> {
  if (!publicMessage) return;
  try {
    await publicMessage.delete();
  } catch {
    // best effort
  }
}

async function finalizeSecretVote(
  sessionId: string,
  reason: 'timeout' | 'complete'
): Promise<void> {
  const session = getSecretVoteSession(sessionId);
  if (!session) return;
  if (!beginSecretVoteFinalization(session)) return;

  clearSecretVoteTimeout(session);

  const voterIds = session.voters.map((voter) => voter.id);
  const result = evaluateSecretVoteOutcome(
    session.action,
    session.turn,
    voterIds,
    session.votes
  );

  try {
    requestSecretVotePublicRender(
      session,
      buildSecretVoteStatus(session, true, result)
    );
  } catch (err) {
    console.error('Failed to publish secret vote final embed', {
      err,
      voteId: session.voteId,
      guildId: session.guildId,
      voiceChannelId: session.voiceChannelId,
      reason,
    });
  }

  if (reason === 'timeout' && result.nonVoterIds.length > 0) {
    await notifySecretVoteTimedOutVoters(session, result.nonVoterIds);
  } else {
    await disableSecretVoteDmButtons(session, [...session.awaiting]);
  }

  closeSecretVoteSession(session);
}

export async function startSecretVote(
  options: StartSecretVoteOptions
): Promise<StartSecretVoteResult> {
  if (options.voters.length < 2) {
    return {
      ok: false,
      kind: 'TOO_FEW_VOTERS',
      message: `${EMOJI_FAIL} A secret vote requires at least **2** eligible voters.`,
    };
  }

  const didReserve = reserveSecretVoteVoice(options.guild.id, options.voiceChannelId);
  if (!didReserve) {
    return {
      ok: false,
      kind: 'ACTIVE_VOTE',
      message: `${EMOJI_FAIL} A secret vote is already running for that voice channel.`,
    };
  }

  let shouldReleaseReservation = true;

  try {
    const voteId = randomUUID();
    const { startedAtMs, endsAtMs } = createSecretVoteDeadlineWindow();

    const initialStatus = buildInitialSecretVoteStatus({
      voteId,
      action: options.action,
      turn: options.turn,
      details: options.details,
      hostId: options.host.id,
      startedAtMs,
      endsAtMs,
      voters: options.voters.map((voter) => ({
        id: voter.id,
        displayName: voter.displayName,
      })),
    });

    const [publicMessageResult, dmSendResult] = await Promise.allSettled([
      sendSecretVotePublicMessage(options.commandChannel, initialStatus),
      sendSecretVoteDmPrompts({
        voteId,
        hostUsername: options.host.username,
        action: options.action,
        turn: options.turn,
        details: options.details,
        voters: options.voters,
      }),
    ]);

    const maybePublicMessage = publicMessageResult.status === 'fulfilled'
      ? publicMessageResult.value
      : null;

    if (dmSendResult.status !== 'fulfilled') {
      await safeDeletePublicSecretVoteMessage(maybePublicMessage);
      return {
        ok: false,
        kind: 'SEND_FAILED',
        message: `${EMOJI_ERROR} Secret vote failed due to an unexpected DM send error.`,
      };
    }

    const dmResult = dmSendResult.value;
    if (!dmResult.ok) {
      await safeDeletePublicSecretVoteMessage(maybePublicMessage);
      await rollbackSecretVoteDmMessages(dmResult.sentMessages);
      const name = dmResult.failedVoter.displayName
        ? `**${dmResult.failedVoter.displayName}**`
        : `<@${dmResult.failedVoter.id}>`;
      return {
        ok: false,
        kind: 'DM_BLOCKED',
        message: `${EMOJI_ERROR} Cannot start vote — I couldn't DM ${name}. They likely have DMs disabled.`,
      };
    }

    if (publicMessageResult.status !== 'fulfilled') {
      await rollbackSecretVoteDmMessages([...dmResult.dmMessages.values()]);
      return {
        ok: false,
        kind: 'SEND_FAILED',
        message: `${EMOJI_ERROR} I couldn't post the public vote embed in this channel.`,
      };
    }

    const publicMessage = publicMessageResult.value;

    const session = createSecretVoteSession({
      voteId,
      guildId: options.guild.id,
      voiceChannelId: options.voiceChannelId,
      hostId: options.host.id,
      action: options.action,
      turn: options.turn,
      details: options.details,
      voters: options.voters.map((voter) => ({
        id: voter.id,
        displayName: voter.displayName,
      })),
      startedAtMs,
      endsAtMs,
      dmMessages: new Map(dmResult.dmMessages),
      publicMessage,
    });

    registerSecretVoteSession(session);
    releaseSecretVoteVoiceReservation(options.guild.id, options.voiceChannelId);
    shouldReleaseReservation = false;

    scheduleSecretVoteTimeout(session, () => {
      void finalizeSecretVote(voteId, 'timeout');
    });

    return { ok: true, voteId, publicMessageUrl: publicMessage.url };
  } finally {
    if (shouldReleaseReservation) {
      releaseSecretVoteVoiceReservation(options.guild.id, options.voiceChannelId);
    }
  }
}

export async function recordSecretVoteChoice(
  voteId: string,
  voterId: string,
  choice: SecretVoteChoice,
  submittedAtMs: number = Date.now()
): Promise<RecordSecretVoteResult> {
  const session = getSecretVoteSession(voteId);
  if (!session || !isSecretVoteCollecting(session)) {
    return {
      ok: false,
      kind: 'NOT_ACTIVE',
      message: `${EMOJI_FAIL} This vote is no longer active.`,
    };
  }

  if (!isSecretVoteWithinAcceptanceWindow(session.endsAtMs, submittedAtMs)) {
    return {
      ok: false,
      kind: 'NOT_ACTIVE',
      message: `${EMOJI_FAIL} This vote is no longer active.`,
    };
  }

  if (!isSecretVoteVoter(session, voterId)) {
    return {
      ok: false,
      kind: 'NOT_ELIGIBLE',
      message: `${EMOJI_FAIL} You're not eligible to vote in this poll.`,
    };
  }

  if (hasSecretVoteVoted(session, voterId)) {
    return {
      ok: false,
      kind: 'ALREADY_VOTED',
      message: `${EMOJI_FAIL} Your vote was already recorded.`,
    };
  }

  recordSecretVoteInSession(session, voterId, choice);

  const isComplete = session.awaiting.size === 0;
  if (isComplete) {
    void finalizeSecretVote(voteId, 'complete');
    return { ok: true, kind: 'RECORDED', isComplete, choice };
  }

  requestSecretVotePublicRender(session, buildSecretVoteStatus(session, false));

  return { ok: true, kind: 'RECORDED', isComplete, choice };
}

export { evaluateSecretVoteOutcome, isSecretVoteActive };
