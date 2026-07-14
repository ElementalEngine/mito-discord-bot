import type { RandomSource } from '../random.js';
import { pickItem, shuffledCopy } from '../random.js';
import type {
  BlindDraftState,
  CwcDraftState,
  DraftEngineInput,
  DraftSessionConfig,
  DraftSessionState,
  EnginePick,
  InteractiveDraftKind,
  SnakeDraftState,
} from '../types.js';
import type { DraftEngineEvent } from '../events.js';
import { publicEvent, seatEvent } from '../events.js';
import { ENGINE_CWC_PICK_ORDER, ENGINE_DRAFT_TIMERS_MS } from './constants.js';
import { assertDraftFormatAllowed, resolveVoteStandardDraft } from './formats.js';
import { buildKeyedCivPool, buildKeyedLeaderPool } from './pools.js';
import type { DraftInputError } from './errors.js';
import { DraftError, inputError } from './errors.js';

export type DraftResult = Readonly<{
  state: DraftSessionState;
  events: readonly DraftEngineEvent[];
}>;

type DraftReducerInput = Exclude<DraftEngineInput, { type: 'CANCEL' }>;

export type DraftCreation = Readonly<{
  state: DraftSessionState;
  events: readonly DraftEngineEvent[];
}>;

function timersFor(config: DraftSessionConfig): DraftSessionState['timers'] {
  return { ...ENGINE_DRAFT_TIMERS_MS, ...config.timers };
}

// ── Create ──────────────────────────────────────────────────

export function createDraftSession(
  kind: InteractiveDraftKind,
  config: DraftSessionConfig,
  rng: RandomSource,
): DraftCreation {
  switch (kind) {
    case 'blind':
      return createBlindSession(config, rng);
    case 'snake':
      return createSnakeSession(config, rng);
    case 'cwc':
      return createCwcSession(config, rng);
  }
}

function baseFields(config: DraftSessionConfig): Pick<
  DraftSessionState,
  'sessionId' | 'voteUuid' | 'edition' | 'startingAge' | 'seatIds' | 'hostId' | 'timers'
> {
  return {
    sessionId: config.sessionId,
    voteUuid: config.voteUuid,
    edition: config.edition,
    startingAge: config.startingAge,
    seatIds: config.seatIds,
    hostId: config.hostId,
    timers: timersFor(config),
  };
}

function createBlindSession(config: DraftSessionConfig, rng: RandomSource): DraftCreation {
  assertDraftFormatAllowed('blind', config.gameType);
  let draft;
  try {
    draft = resolveVoteStandardDraft(config, rng);
  } catch (err: unknown) {
    throw new DraftError('VALIDATION', err instanceof Error ? err.message : 'Blind draft setup failed.');
  }

  const pools: Record<string, { leaders: readonly string[]; civs?: readonly string[] }> = {};
  config.seatIds.forEach((seatId, index) => {
    const group = draft.groups[index];
    pools[seatId] = config.edition === 'CIV6'
      ? { leaders: group?.leaders ?? [] }
      : { leaders: group?.leaders ?? [], civs: group?.civs ?? [] };
  });

  const state: BlindDraftState = {
    ...baseFields(config),
    kind: 'blind',
    pools,
    picks: {},
    staged: {},
    phase: 'collecting',
    completionReason: null,
    status: 'active',
    cancelReason: null,
  };

  const events: DraftEngineEvent[] = [
    publicEvent('SESSION_STARTED', { kind: 'blind', edition: state.edition, seatIds: state.seatIds }),
    ...state.seatIds.map((seatId) =>
      seatEvent('POOLS_DEALT', seatId, { seatId, pools: pools[seatId] as { leaders: readonly string[]; civs?: readonly string[] } }),
    ),
    publicEvent('DEADLINE_SET', { durationMs: state.timers.blind, deadlineKind: 'session' }),
  ];

  return { state, events };
}

function createSnakeSession(config: DraftSessionConfig, rng: RandomSource): DraftCreation {
  assertDraftFormatAllowed('snake', config.gameType);

  const leaderPool = buildKeyedLeaderPool({
    edition: config.edition,
    bannedLeaderKeys: config.bannedLeaderKeys,
  });
  if (leaderPool.length < config.seatIds.length) {
    throw new DraftError('NO_POOL', 'Not enough leaders remain after bans for snake draft.');
  }

  const civPool = buildKeyedCivPool({
    edition: config.edition,
    startingAge: config.startingAge,
    bannedCivKeys: config.bannedCivKeys,
  });
  if (config.edition === 'CIV7' && civPool.length === 0) {
    throw new DraftError('NO_POOL', 'No civs remain after bans for snake draft.');
  }

  const order = shuffledCopy(config.seatIds, rng);
  const state: SnakeDraftState = {
    ...baseFields(config),
    kind: 'snake',
    order,
    civOrder: [...order].reverse(),
    leaderPool,
    civPool,
    picks: {},
    staged: {},
    round: 'leader',
    turnIndex: 0,
    turnToken: 1,
    status: 'active',
    completionNote: null,
    cancelReason: null,
  };

  const events: DraftEngineEvent[] = [
    publicEvent('SESSION_STARTED', { kind: 'snake', edition: state.edition, seatIds: state.seatIds }),
    publicEvent('ORDER_SET', { order: state.order, note: 'Initial order randomized.' }),
    publicEvent('TURN_STARTED', {
      seatId: state.order[0] as string,
      round: 'leader',
      turnToken: state.turnToken,
      durationMs: state.timers.snakePick,
    }),
  ];

  return { state, events };
}

function createCwcSession(config: DraftSessionConfig, rng: RandomSource): DraftCreation {
  assertDraftFormatAllowed('cwc', config.gameType);
  if (config.numberTeams !== 2) {
    throw new DraftError('VALIDATION', 'CWC requires exactly 2 teams.');
  }
  if (config.seatIds.length < 4 || config.seatIds.length > 16 || config.seatIds.length % 2 !== 0) {
    throw new DraftError('VALIDATION', 'CWC requires an even player count from 4 to 16.');
  }

  const leaderPool = buildKeyedLeaderPool({
    edition: config.edition,
    bannedLeaderKeys: config.bannedLeaderKeys,
  });
  if (leaderPool.length < config.seatIds.length) {
    throw new DraftError('NO_POOL', 'Not enough leaders remain after bans for CWC.');
  }

  const civPool = buildKeyedCivPool({
    edition: config.edition,
    startingAge: config.startingAge,
    bannedCivKeys: config.bannedCivKeys,
  });
  if (config.edition === 'CIV7' && civPool.length === 0) {
    throw new DraftError('NO_POOL', 'No civs remain after bans for CWC.');
  }

  const teamSize = Math.floor(config.seatIds.length / 2);
  const state: CwcDraftState = {
    ...baseFields(config),
    kind: 'cwc',
    captainIds: [null, null],
    leaderPool: shuffledCopy(leaderPool, rng),
    civPool: shuffledCopy(civPool, rng),
    teamPicks: [
      { leaders: [], civs: [] },
      { leaders: [], civs: [] },
    ],
    pickOrder: [...ENGINE_CWC_PICK_ORDER.slice(0, teamSize * 2)],
    round: 'captains',
    turnIndex: 0,
    turnToken: 0,
    status: 'active',
    cancelReason: null,
  };

  const events: DraftEngineEvent[] = [
    publicEvent('SESSION_STARTED', { kind: 'cwc', edition: state.edition, seatIds: state.seatIds }),
    publicEvent('DEADLINE_SET', { durationMs: state.timers.cwcCaptainSelect, deadlineKind: 'captains' }),
  ];

  return { state, events };
}

// ── Reduce ──────────────────────────────────────────────────

export function processDraftInput(
  state: DraftSessionState,
  input: DraftEngineInput,
  rng: RandomSource,
): DraftResult | DraftInputError {
  if (input.type === 'CANCEL') {
    if (state.status !== 'active') {
      return inputError('INACTIVE', inactiveMessage(state));
    }
    const next = cloneState(state);
    next.status = 'cancelled';
    next.cancelReason = input.reason;
    return { state: next, events: [publicEvent('DRAFT_CANCELLED', { reason: input.reason })] };
  }

  if (state.status !== 'active') {
    return inputError('INACTIVE', inactiveMessage(state));
  }

  switch (state.kind) {
    case 'blind':
      return reduceBlind(state, input);
    case 'snake':
      return reduceSnake(state, input, rng);
    case 'cwc':
      return reduceCwc(state, input, rng);
  }
}

function inactiveMessage(state: DraftSessionState): string {
  switch (state.kind) {
    case 'blind':
      return '⚠️ Blind draft is not active.';
    case 'snake':
      return '⚠️ Snake draft is not active.';
    case 'cwc':
      return '⚠️ CWC draft is not active.';
  }
}

function cloneState<T extends DraftSessionState>(state: T): T {
  // States are JSON-safe by construction (Records/arrays/primitives only).
  return structuredClone(state);
}

function clonePick(pick: EnginePick | undefined): EnginePick {
  return pick ? { ...pick } : {};
}

// ── Blind ───────────────────────────────────────────────────

function blindReady(edition: BlindDraftState['edition'], pick: EnginePick | undefined): boolean {
  return edition === 'CIV6'
    ? Boolean(pick?.leaderKey)
    : Boolean(pick?.leaderKey) && Boolean(pick?.civKey);
}

function blindProgress(state: BlindDraftState): DraftEngineEvent {
  return publicEvent('PROGRESS_CHANGED', {
    stagedSeatIds: Object.keys(state.staged),
    committedSeatIds: Object.keys(state.picks),
  });
}

function blindComplete(state: BlindDraftState): boolean {
  return state.seatIds.every((seatId) => blindReady(state.edition, state.picks[seatId]));
}

function finalizeBlind(state: BlindDraftState, reason: 'complete' | 'timeout'): DraftResult {
  const next = cloneState(state);
  next.phase = 'complete';
  next.completionReason = reason;
  next.status = 'complete';
  return {
    state: next,
    events: [
      publicEvent('PICKS_REVEALED', { picks: next.picks, reason }),
      publicEvent('DRAFT_COMPLETED', { reason }),
    ],
  };
}

function reduceBlind(state: BlindDraftState, input: DraftReducerInput): DraftResult | DraftInputError {
  if (input.type === 'TIMEOUT') {
    // Legacy parity: no auto-assignment; picks stay as-is and are revealed.
    return finalizeBlind(state, 'timeout');
  }

  if (input.type !== 'STAGE' && input.type !== 'SUBMIT') {
    return inputError('VALIDATION', '⚠️ Blind draft is not currently accepting that action.');
  }

  if (!state.seatIds.includes(input.seatId)) {
    return inputError('NOT_MEMBER', '⚠️ You are not part of this blind draft.');
  }

  const pools = state.pools[input.seatId];
  if (!pools) {
    return inputError('UNAVAILABLE', '⚠️ Blind draft options are unavailable.');
  }

  if (input.type === 'STAGE') {
    const allowed = input.pickType === 'civ'
      ? (pools.civs ?? []).includes(input.key)
      : pools.leaders.includes(input.key);
    if (!allowed) {
      return inputError('UNAVAILABLE', '⚠️ That choice is not available in your blind draft pool.');
    }

    const next = cloneState(state);
    const staged = clonePick(next.staged[input.seatId] ?? next.picks[input.seatId]);
    if (input.pickType === 'leader') staged.leaderKey = input.key;
    else staged.civKey = input.key;
    next.staged[input.seatId] = staged;

    return {
      state: next,
      events: [
        seatEvent('STAGE_UPDATED', input.seatId, { seatId: input.seatId, staged: { ...staged } }),
        blindProgress(next),
      ],
    };
  }

  // SUBMIT
  const staged = state.staged[input.seatId] ?? state.picks[input.seatId];
  if (!blindReady(state.edition, staged) || !staged?.leaderKey) {
    return inputError('NOT_READY', '⚠️ Pick all required options before submitting.');
  }
  if (
    !pools.leaders.includes(staged.leaderKey)
    || (state.edition === 'CIV7' && (!staged.civKey || !(pools.civs ?? []).includes(staged.civKey)))
  ) {
    return inputError('UNAVAILABLE', '⚠️ That choice is not available in your blind draft pool.');
  }

  const next = cloneState(state);
  next.picks[input.seatId] = { ...staged };

  const events: DraftEngineEvent[] = [
    publicEvent('PICK_COMMITTED', { seatId: input.seatId, auto: false }),
    blindProgress(next),
  ];

  if (blindComplete(next)) {
    const finalized = finalizeBlind(next, 'complete');
    return { state: finalized.state, events: [...events, ...finalized.events] };
  }

  return { state: next, events };
}

// ── Snake ───────────────────────────────────────────────────

function snakeCurrentOrder(state: SnakeDraftState): readonly string[] {
  if (state.round === 'leader') return state.order;
  if (state.round === 'civ') return state.civOrder;
  return [];
}

function snakeCurrentPickerId(state: SnakeDraftState): string | null {
  return snakeCurrentOrder(state)[state.turnIndex] ?? null;
}

function snakeAvailableLeaders(state: SnakeDraftState): string[] {
  const used = new Set(
    Object.values(state.picks)
      .map((pick) => pick.leaderKey)
      .filter(Boolean),
  );
  return state.leaderPool.filter((key) => !used.has(key));
}

function snakeAvailableCivs(state: SnakeDraftState): string[] {
  if (state.edition !== 'CIV7') return [];
  return [...state.civPool];
}

function snakeAdvanceTurn(state: SnakeDraftState): void {
  const order = snakeCurrentOrder(state);
  if (state.turnIndex + 1 < order.length) {
    state.turnIndex += 1;
    return;
  }

  if (state.edition === 'CIV7' && state.round === 'leader') {
    state.round = 'civ';
    state.turnIndex = 0;
    return;
  }

  state.round = 'complete';
}

function snakeNextTurnEvents(state: SnakeDraftState): DraftEngineEvent[] {
  if (state.round === 'complete') {
    state.status = 'complete';
    return [publicEvent('DRAFT_COMPLETED', { reason: 'complete' })];
  }

  state.turnToken += 1;
  return [
    publicEvent('TURN_STARTED', {
      seatId: snakeCurrentPickerId(state) as string,
      round: state.round as 'leader' | 'civ',
      turnToken: state.turnToken,
      durationMs: state.timers.snakePick,
    }),
  ];
}

function snakeApplyPick(state: SnakeDraftState, seatId: string, key: string, auto: boolean): DraftResult {
  const next = cloneState(state);
  const pick = clonePick(next.picks[seatId]);
  const round = next.round as 'leader' | 'civ';
  if (round === 'leader') pick.leaderKey = key;
  else pick.civKey = key;
  next.picks[seatId] = pick;
  delete next.staged[seatId];

  const events: DraftEngineEvent[] = [
    publicEvent('PICK_COMMITTED', { seatId, round, key, auto }),
  ];
  if (auto) {
    events.push(publicEvent('AUTO_PICK_APPLIED', { seatId, round, key }));
  }

  snakeAdvanceTurn(next);
  events.push(...snakeNextTurnEvents(next));
  return { state: next, events };
}

function reduceSnake(
  state: SnakeDraftState,
  input: DraftReducerInput,
  rng: RandomSource,
): DraftResult | DraftInputError {
  if (input.type === 'TIMEOUT') {
    if (state.round === 'complete') {
      return { state: cloneState(state), events: [] };
    }
    const seatId = snakeCurrentPickerId(state);
    if (!seatId) {
      return { state: cloneState(state), events: [] };
    }

    const available = state.round === 'leader' ? snakeAvailableLeaders(state) : snakeAvailableCivs(state);
    if (available.length === 0) {
      const next = cloneState(state);
      next.round = 'complete';
      next.status = 'complete';
      next.completionNote = 'no-pool';
      return {
        state: next,
        events: [
          publicEvent('SESSION_CLOSED_NO_POOL', {
            message: 'Snake draft closed because no valid picks remained.',
          }),
          publicEvent('DRAFT_COMPLETED', { reason: 'no-pool' }),
        ],
      };
    }

    return snakeApplyPick(state, seatId, pickItem(available, rng), true);
  }

  if (input.type === 'SELECT_CAPTAIN' || input.type === 'PICK') {
    return inputError('VALIDATION', '⚠️ Snake draft is not currently accepting that action.');
  }

  // STAGE / SUBMIT — legacy guard order preserved.
  if (input.turnToken !== undefined && input.turnToken !== state.turnToken) {
    return inputError('STALE', '⚠️ This pick prompt has expired.');
  }
  if (snakeCurrentPickerId(state) !== input.seatId) {
    return inputError('NOT_YOUR_TURN', '⚠️ It is not your turn to pick.');
  }

  if (input.type === 'STAGE') {
    if (input.pickType !== state.round) {
      return inputError('VALIDATION', '⚠️ That pick prompt is no longer active.');
    }
    const available = input.pickType === 'leader' ? snakeAvailableLeaders(state) : snakeAvailableCivs(state);
    if (!available.includes(input.key)) {
      return inputError('UNAVAILABLE', '⚠️ That choice is no longer available.');
    }

    const next = cloneState(state);
    const staged = clonePick(next.staged[input.seatId] ?? next.picks[input.seatId]);
    if (input.pickType === 'leader') staged.leaderKey = input.key;
    else staged.civKey = input.key;
    next.staged[input.seatId] = staged;

    return {
      state: next,
      events: [seatEvent('STAGE_UPDATED', input.seatId, { seatId: input.seatId, staged: { ...staged } })],
    };
  }

  // SUBMIT (a 'complete' round cannot reach here: its picker is null, so the
  // NOT_YOUR_TURN guard above already fired — no separate round guard needed)
  const staged = state.staged[input.seatId] ?? state.picks[input.seatId];
  const key = state.round === 'leader' ? staged?.leaderKey : staged?.civKey;
  if (!key) {
    return inputError('NOT_READY', '⚠️ Choose a pick before submitting.');
  }
  const available = state.round === 'leader' ? snakeAvailableLeaders(state) : snakeAvailableCivs(state);
  if (!available.includes(key)) {
    return inputError('UNAVAILABLE', '⚠️ That choice is no longer available.');
  }

  return snakeApplyPick(state, input.seatId, key, false);
}

// ── CWC ─────────────────────────────────────────────────────

function cwcCurrentTeamIndex(state: CwcDraftState): 0 | 1 {
  return (state.pickOrder[state.turnIndex] ?? 0) as 0 | 1;
}

function cwcCurrentCaptainId(state: CwcDraftState): string | null {
  if (state.round === 'captains' || state.round === 'complete') return null;
  return state.captainIds[cwcCurrentTeamIndex(state)];
}

function cwcAvailableLeaders(state: CwcDraftState): string[] {
  const used = new Set([...state.teamPicks[0].leaders, ...state.teamPicks[1].leaders]);
  return state.leaderPool.filter((key) => !used.has(key));
}

function cwcAvailableCivs(state: CwcDraftState): string[] {
  if (state.edition !== 'CIV7') return [];
  return [...state.civPool];
}

function cwcAdvanceTurn(state: CwcDraftState): void {
  if (state.turnIndex + 1 < state.pickOrder.length) {
    state.turnIndex += 1;
    return;
  }

  if (state.edition === 'CIV7' && state.round === 'leader') {
    state.round = 'civ';
    state.turnIndex = 0;
    return;
  }

  state.round = 'complete';
}

function cwcNextStepEvents(state: CwcDraftState): DraftEngineEvent[] {
  if (state.round === 'complete') {
    state.status = 'complete';
    return [publicEvent('DRAFT_COMPLETED', { reason: 'complete' })];
  }

  state.turnToken += 1;
  const teamIndex = cwcCurrentTeamIndex(state);
  return [
    publicEvent('TURN_STARTED', {
      seatId: state.captainIds[teamIndex] as string,
      round: state.round as 'leader' | 'civ',
      turnToken: state.turnToken,
      durationMs: state.timers.cwcPick,
      teamIndex,
    }),
  ];
}

function cwcStartLeaderRound(state: CwcDraftState): DraftEngineEvent[] {
  state.round = 'leader';
  state.turnIndex = 0;
  return [publicEvent('ROUND_ADVANCED', { round: 'leader' }), ...cwcNextStepEvents(state)];
}

function reduceCwc(
  state: CwcDraftState,
  input: DraftReducerInput,
  rng: RandomSource,
): DraftResult | DraftInputError {
  if (input.type === 'TIMEOUT') {
    if (state.round === 'captains') {
      // Legacy handleCaptainTimeout parity, including its remaining-set derivations.
      const next = cloneState(state);
      const events: DraftEngineEvent[] = [];
      const remaining = next.seatIds.filter((id) => !next.captainIds.includes(id));
      if (!next.captainIds[0]) {
        next.captainIds[0] = pickItem(remaining, rng);
        events.push(publicEvent('CAPTAIN_SET', { teamIndex: 0, userId: next.captainIds[0], auto: true }));
      }
      const remainingAfterTeam1 = next.seatIds.filter(
        (id) => id !== next.captainIds[0] && id !== next.captainIds[1],
      );
      if (!next.captainIds[1]) {
        next.captainIds[1] = pickItem(remainingAfterTeam1, rng);
        events.push(publicEvent('CAPTAIN_SET', { teamIndex: 1, userId: next.captainIds[1], auto: true }));
      }
      events.push(...cwcStartLeaderRound(next));
      return { state: next, events };
    }

    if (state.round === 'complete') {
      return { state: cloneState(state), events: [] };
    }

    // Pick timeout (legacy handlePickTimeout parity).
    const next = cloneState(state);
    const teamIndex = cwcCurrentTeamIndex(next);
    const events: DraftEngineEvent[] = [];
    if (next.round === 'leader') {
      const available = cwcAvailableLeaders(next);
      if (available.length === 0) {
        next.round = 'complete';
        next.status = 'complete';
        return { state: next, events: [publicEvent('DRAFT_COMPLETED', { reason: 'no-pool' })] };
      }
      const key = pickItem(available, rng);
      next.teamPicks[teamIndex].leaders.push(key);
      events.push(publicEvent('AUTO_PICK_APPLIED', {
        seatId: next.captainIds[teamIndex] ?? '',
        round: 'leader',
        key,
        teamIndex,
      }));
    } else {
      const available = cwcAvailableCivs(next);
      if (available.length === 0) {
        next.round = 'complete';
        next.status = 'complete';
        return { state: next, events: [publicEvent('DRAFT_COMPLETED', { reason: 'no-pool' })] };
      }
      const key = pickItem(available, rng);
      next.teamPicks[teamIndex].civs.push(key);
      events.push(publicEvent('AUTO_PICK_APPLIED', {
        seatId: next.captainIds[teamIndex] ?? '',
        round: 'civ',
        key,
        teamIndex,
      }));
    }

    cwcAdvanceTurn(next);
    events.push(...cwcNextStepEvents(next));
    return { state: next, events };
  }

  if (input.type === 'SELECT_CAPTAIN') {
    if (input.byUserId !== state.hostId) {
      return inputError('NOT_HOST', '⚠️ Only the vote host can select captains.');
    }
    // Server-authoritative hardening over the legacy handler (parity delta
    // P1): the Discord select menu constrained choices to voters; an
    // untrusted Activity client cannot be trusted the same way.
    if (!state.seatIds.includes(input.userId)) {
      return inputError('NOT_MEMBER', '⚠️ Captains must be members of this vote.');
    }
    const otherIndex: 0 | 1 = input.teamIndex === 0 ? 1 : 0;
    if (state.captainIds[otherIndex] === input.userId) {
      return inputError('VALIDATION', '⚠️ Team captains must be different users.');
    }
    if (state.round !== 'captains') {
      return inputError('VALIDATION', '⚠️ CWC draft is not currently accepting picks.');
    }

    const next = cloneState(state);
    next.captainIds[input.teamIndex] = input.userId;
    const events: DraftEngineEvent[] = [
      publicEvent('CAPTAIN_SET', { teamIndex: input.teamIndex, userId: input.userId, auto: false }),
    ];

    if (next.captainIds[0] && next.captainIds[1]) {
      events.push(...cwcStartLeaderRound(next));
    }

    return { state: next, events };
  }

  if (input.type !== 'PICK') {
    return inputError('VALIDATION', '⚠️ CWC draft is not currently accepting that action.');
  }

  // Legacy guard order preserved.
  if (state.round === 'captains' || state.round === 'complete') {
    return inputError('VALIDATION', '⚠️ CWC draft is not currently accepting picks.');
  }
  if (input.turnToken !== state.turnToken) {
    return inputError('STALE', '⚠️ That pick menu is stale.');
  }
  const currentCaptainId = cwcCurrentCaptainId(state);
  if (!currentCaptainId || input.seatId !== currentCaptainId) {
    return inputError('NOT_YOUR_TURN', '⚠️ It is not your turn to pick.');
  }

  const next = cloneState(state);
  const teamIndex = cwcCurrentTeamIndex(next);
  const events: DraftEngineEvent[] = [];

  if (next.round === 'leader') {
    const available = cwcAvailableLeaders(next);
    if (!available.includes(input.key)) {
      return inputError('UNAVAILABLE', '⚠️ That leader is no longer available.');
    }
    next.teamPicks[teamIndex].leaders.push(input.key);
    events.push(publicEvent('PICK_COMMITTED', {
      seatId: input.seatId,
      round: 'leader',
      key: input.key,
      auto: false,
      teamIndex,
    }));
  } else {
    const available = cwcAvailableCivs(next);
    if (!available.includes(input.key)) {
      return inputError('UNAVAILABLE', '⚠️ That civ is no longer available.');
    }
    next.teamPicks[teamIndex].civs.push(input.key);
    events.push(publicEvent('PICK_COMMITTED', {
      seatId: input.seatId,
      round: 'civ',
      key: input.key,
      auto: false,
      teamIndex,
    }));
  }

  cwcAdvanceTurn(next);
  events.push(...cwcNextStepEvents(next));
  return { state: next, events };
}
