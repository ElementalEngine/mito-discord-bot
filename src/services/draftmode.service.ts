import type { DraftCommandRequest, VoteDraftRequest } from '../types/draft.js';
import type { DraftModeOutput } from '../types/drafting.types.js';
import { runBlindDraftMode } from './draftmodes/blind.js';
import { runCwcDraftMode } from './draftmodes/cwc.js';
import { runRandomDraftMode } from './draftmodes/random.js';
import { runSnakeDraftMode } from './draftmodes/snake.js';
import { runStandardDraftMode } from './draftmodes/standard.js';

export async function executeDraftMode(
  request: DraftCommandRequest | VoteDraftRequest,
): Promise<DraftModeOutput | null> {
  switch (request.draftMode) {
    case 'standard':
      return runStandardDraftMode(request);
    case 'snake':
      return runSnakeDraftMode(request);
    case 'random':
      return runRandomDraftMode(request);
    case 'cwc':
      return runCwcDraftMode(request);
    case 'blind':
      return runBlindDraftMode(request);
  }
}
