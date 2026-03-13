import type { DraftGameType } from '../types/drafting.types.js';
import type { VoteQuestion } from './types.js';

import { CIV6_VOTING_QUESTIONS, getCiv6DraftModeQuestion } from './civ6-voting.config.js';

export const CIV7_VOTING_QUESTIONS: Readonly<Record<DraftGameType, readonly VoteQuestion[]>> = {
  FFA: [...CIV6_VOTING_QUESTIONS.FFA],
  Duel: [...CIV6_VOTING_QUESTIONS.Duel],
  Teamer: [...CIV6_VOTING_QUESTIONS.Teamer],
};

export function getCiv7DraftModeQuestion(gameType: DraftGameType): VoteQuestion {
  return getCiv6DraftModeQuestion(gameType);
}
