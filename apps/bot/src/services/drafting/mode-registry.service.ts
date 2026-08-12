import type { DraftCommandRequest, VoteDraftRequest } from '../../types/drafting.types.js';
import type { DraftModeOutput } from '../../types/drafting.types.js';
import { runBlindDraftMode } from './modes/blind.js';
import { runCwcDraftMode } from './modes/cwc.js';
import { runRandomDraftMode } from './modes/random.js';
import { runSnakeDraftMode } from './modes/snake.js';
import { runStandardDraftMode } from './modes/standard.js';

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
