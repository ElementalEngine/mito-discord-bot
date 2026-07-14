// R2 engine public surface. ENGINE_SCAFFOLD is kept so the R1 wiring smoke
// test (tests/smoke.test.ts) stays valid; it is removed with the scaffolds at
// R9.
export const ENGINE_SCAFFOLD = true as const;

export type { RandomSource } from './random.js';
export { createSeededRandom, pickItem, randomIndex, shuffleInPlace, shuffledCopy } from './random.js';

export type {
  BlindDraftState,
  CwcDraftState,
  CwcTeamPicks,
  DraftEngineInput,
  DraftSessionConfig,
  DraftSessionState,
  EnginePick,
  EngineSeatPools,
  InteractiveDraftKind,
  SnakeDraftState,
  SnakeRound,
  CwcRound,
} from './types.js';

export type { DraftEngineEvent, EventVisibility } from './events.js';
export { eventsVisibleToSeat, publicEvent, seatEvent } from './events.js';

export { DraftError, inputError, isDraftInputError } from './draft/errors.js';
export type { DraftInputError } from './draft/errors.js';

export { ENGINE_CWC_PICK_ORDER, ENGINE_DRAFT_TIMERS_MS } from './draft/constants.js';
export type { EngineDraftTimersMs } from './draft/constants.js';

export {
  buildCivBanIndex,
  buildKeyedCivPool,
  buildKeyedLeaderPool,
  buildLeaderBanIndex,
  getAvailableCiv6LeaderKeys,
  getAvailableCiv7CivKeys,
  getAvailableCiv7LeaderKeys,
  resolveEmojiBans,
  tokenizeBans,
} from './draft/pools.js';
export type { BanResolution } from './draft/pools.js';

export {
  buildAllocationNote,
  computeLeadersPerGroup,
  getCiv7CivTarget,
  LEADER_TYPES,
} from './draft/rules.js';

export {
  computeLayout,
  generateCiv6DraftCore,
  generateCiv7DraftCore,
  generateDirectCiv6DraftCore,
  generateDirectCiv7DraftCore,
} from './draft/allocation.js';

export {
  assertDraftFormatAllowed,
  DRAFT_FORMATS,
  getDraftFormat,
  isDraftFormatAllowed,
  keysToColonTokens,
  resolveVoteStandardDraft,
} from './draft/formats.js';
export type { DraftFormatDescriptor, DraftFormatId } from './draft/formats.js';

export { createDraftSession, processDraftInput } from './draft/machine.js';
export type { DraftCreation, DraftResult } from './draft/machine.js';

export {
  decodeVoteSelections,
  encodeVoteSelections,
  getQuestionMaxSelections,
  isMultiSelectQuestion,
  pickRandomVoteValue,
  voteCountByOption,
} from './vote/tally.js';
export type { VoteRecord } from './vote/tally.js';

export {
  getDraftModeFromLocked,
  lockAllQuestions,
  resolveQuestionWinner,
} from './vote/plurality.js';
export type { LockedSettings, QuestionTiebreak, QuestionWinner } from './vote/plurality.js';

export { majorityBans, majorityThreshold, summarizeSubmittedBans } from './vote/bans.js';
export type { BanSummary } from './vote/bans.js';

export { normalizeRankedBallot, resolveRankedChoiceElection } from './vote/irv.js';
export type {
  RankedChoiceResolution,
  RankedChoiceRound,
  RankedChoiceRoundTally,
  RankedChoiceTieBreak,
  RankedChoiceTieBreakRule,
} from './vote/irv.js';
