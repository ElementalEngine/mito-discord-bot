import type { GameVoteProgress, GameVoteSession } from '../../../types/voting.types.js';

export function buildProgress(v: GameVoteSession): GameVoteProgress {
  return {
    edition: v.edition,
    status: v.status,
    voters: v.voters,
    finishedIds: new Set(v.finished),
  };
}

export function areAllVotersFinished(v: GameVoteSession): boolean {
  return v.voterIds.every((id) => v.finished.has(id));
}
