import type { CivEdition, GameVoteConfig } from '../../../config/types.js';
import { CIV6_VOTING_QUESTIONS, getCiv6DraftModeQuestion } from '../../../config/civ6-voting.config.js';
import { CIV7_VOTING_QUESTIONS, getCiv7DraftModeQuestion } from '../../../config/civ7-voting.config.js';
import type { DraftGameType } from '../../../types/drafting.types.js';

export function buildGameVoteConfig(args: Readonly<{
  edition: CivEdition;
  gameType: DraftGameType;
}>): GameVoteConfig {
  const baseByGameType = args.edition === 'CIV7' ? CIV7_VOTING_QUESTIONS : CIV6_VOTING_QUESTIONS;
  const draftModeQuestion = args.edition === 'CIV7'
    ? getCiv7DraftModeQuestion(args.gameType)
    : getCiv6DraftModeQuestion(args.gameType);
  const questions = [...baseByGameType[args.gameType], draftModeQuestion];
  return { questions };
}
