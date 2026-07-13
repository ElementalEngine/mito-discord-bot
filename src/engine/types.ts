import type { Civ7StartingAge } from '../data/types.js';
import type { CivEdition } from '../shared/civ.types.js';
import type { DraftGameType } from '../shared/draft.types.js';
import type { EngineDraftTimersMs } from './drafts/constants.js';

export type InteractiveDraftKind = 'blind' | 'snake' | 'cwc';

export type EnginePick = {
  leaderKey?: string;
  civKey?: string;
};

export type EngineSeatPools = Readonly<{
  leaders: readonly string[];
  civs?: readonly string[];
}>;

export type DraftSessionConfig = Readonly<{
  sessionId: string;
  voteUuid: string;
  edition: CivEdition;
  startingAge?: Civ7StartingAge;
  gameType: DraftGameType;
  numberTeams?: number;
  hostId: string;
  /** Voter/seat ids in vote order (legacy voterIds). */
  seatIds: readonly string[];
  /** Pre-resolved ban keys (host bans ∪ majority bans), legacy VoteDraftRequest shape. */
  bannedLeaderKeys: readonly string[];
  bannedCivKeys: readonly string[];
  /** Timer overrides; defaults are ENGINE_DRAFT_TIMERS_MS (legacy values). */
  timers?: Partial<EngineDraftTimersMs>;
}>;

type SessionBase = Readonly<{
  sessionId: string;
  voteUuid: string;
  edition: CivEdition;
  startingAge?: Civ7StartingAge;
  seatIds: readonly string[];
  hostId: string;
  timers: EngineDraftTimersMs;
}>;

export type BlindDraftState = SessionBase & {
  kind: 'blind';
  /** Per-seat private pools, dealt at create (index parity: group i → seat i). */
  pools: Readonly<Record<string, EngineSeatPools>>;
  picks: Record<string, EnginePick>;
  staged: Record<string, EnginePick>;
  phase: 'collecting' | 'complete';
  completionReason: 'complete' | 'timeout' | null;
  status: 'active' | 'complete' | 'cancelled';
  cancelReason: string | null;
};

export type SnakeRound = 'leader' | 'civ' | 'complete';

export type SnakeDraftState = SessionBase & {
  kind: 'snake';
  /** Randomized leader-round order; civ round runs it reversed (the snake). */
  order: readonly string[];
  civOrder: readonly string[];
  leaderPool: readonly string[];
  civPool: readonly string[];
  picks: Record<string, EnginePick>;
  staged: Record<string, EnginePick>;
  round: SnakeRound;
  turnIndex: number;
  turnToken: number;
  status: 'active' | 'complete' | 'cancelled';
  /** 'no-pool' when the session closed because no valid picks remained. */
  completionNote: 'no-pool' | null;
  cancelReason: string | null;
};

export type CwcRound = 'captains' | 'leader' | 'civ' | 'complete';

export type CwcTeamPicks = {
  leaders: string[];
  civs: string[];
};

export type CwcDraftState = SessionBase & {
  kind: 'cwc';
  captainIds: [string | null, string | null];
  /** Shuffled at create (legacy parity). */
  leaderPool: readonly string[];
  civPool: readonly string[];
  teamPicks: [CwcTeamPicks, CwcTeamPicks];
  pickOrder: readonly number[];
  round: CwcRound;
  turnIndex: number;
  turnToken: number;
  status: 'active' | 'complete' | 'cancelled';
  cancelReason: string | null;
};

export type DraftSessionState = BlindDraftState | SnakeDraftState | CwcDraftState;

export type DraftEngineInput =
  | Readonly<{ type: 'STAGE'; seatId: string; pickType: 'leader' | 'civ'; key: string; turnToken?: number }>
  | Readonly<{ type: 'SUBMIT'; seatId: string; turnToken?: number }>
  | Readonly<{ type: 'PICK'; seatId: string; key: string; turnToken: number }>
  | Readonly<{ type: 'SELECT_CAPTAIN'; byUserId: string; teamIndex: 0 | 1; userId: string }>
  | Readonly<{ type: 'TIMEOUT' }>
  | Readonly<{ type: 'CANCEL'; reason: string }>;
