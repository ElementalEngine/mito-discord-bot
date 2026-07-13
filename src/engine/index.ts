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

export { DraftError, inputError, isDraftInputError } from './drafts/errors.js';
export type { DraftInputError } from './drafts/errors.js';

export { ENGINE_CWC_PICK_ORDER, ENGINE_DRAFT_TIMERS_MS } from './drafts/constants.js';
export type { EngineDraftTimersMs } from './drafts/constants.js';

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
} from './drafts/pools.js';
export type { BanResolution } from './drafts/pools.js';

export {
  buildAllocationNote,
  computeLeadersPerGroup,
  getCiv7CivTarget,
  LEADER_TYPES,
} from './drafts/rules.js';

export {
  computeLayout,
  generateCiv6DraftCore,
  generateCiv7DraftCore,
  generateDirectCiv6DraftCore,
  generateDirectCiv7DraftCore,
} from './drafts/allocation.js';

export {
  DRAFT_FORMATS,
  keysToColonTokens,
  resolveRandomDraft,
  resolveVoteStandardDraft,
} from './drafts/formats.js';
export type { DraftFormatDescriptor, RandomDraftAssignment, RandomDraftResult } from './drafts/formats.js';

export { createDraftSession, processDraftInput } from './drafts/machine.js';
export type { DraftCreation, DraftResult } from './drafts/machine.js';

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
