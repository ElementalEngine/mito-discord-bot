import type { VoteDraftRequest } from '../../types/draft.js';
import type { DraftModeDeps } from '../draftmode.service.js';
import { DraftError } from '../draft.service.js';

export async function runBlindDraftMode(
  request: VoteDraftRequest,
  deps: DraftModeDeps
): Promise<null> {
  if (request.source !== 'vote') {
    throw new DraftError('VALIDATION', 'Blind draft is only available from the vote flow.');
  }
  if (!deps.startBlindDraft) {
    throw new DraftError('VALIDATION', 'Blind draft launcher is unavailable.');
  }

  await deps.startBlindDraft(request);
  return null;
}
