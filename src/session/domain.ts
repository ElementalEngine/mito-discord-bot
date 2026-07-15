import {
  createDraftSession,
  processDraftInput,
  resolveVoteStandardDraft,
  resolveQuestionWinner,
  encodeVoteSelections,
  pickRandomVoteValue,
  majorityBans,
  getDraftFormat,
  isDraftFormatAllowed,
  isDraftInputError,
  DraftError,
  DRAFT_FORMATS,
} from '../engine/index.js';
import type {
  RandomSource,
  DraftSessionState,
  DraftSessionConfig,
  DraftEngineEvent,
  DraftEngineInput,
  DraftFormatId,
  InteractiveDraftKind,
  EngineDraftTimersMs,
  QuestionTiebreak,
} from '../engine/index.js';
import type { CivEdition } from '../shared/civ.types.js';
import type { DraftGameType, Civ6DraftResult, Civ7DraftResult } from '../shared/draft.types.js';
import type { GameVoteConfig, VoteQuestion } from '../shared/vote.types.js';
import type { Civ7StartingAge } from '../data/types.js';
import type { DraftTelemetryRecord } from '../core/api/sessions.api.js';
import { buildDraftRecord, buildReportingToken } from './telemetry.js';

// ── Constants (tunable — flagged for a later pass) ──────────────────────────

export const SESSION_PHASES = ['lobby', 'settings', 'bans', 'draft', 'complete', 'cancelled'] as const;
export type SessionPhase = (typeof SESSION_PHASES)[number];

/** Hard seat cap (Discord voice-scale sanity); tunable. */
const MAX_SEATS = 16;
/** Minimum seats before lobby may advance to settings; tunable. */
const MIN_SEATS_TO_START = 2;
/** Session-phase deadline defaults (not engine constants — Activity concerns); tunable. */
const DEFAULT_PHASE_TIMERS_MS = { settings: 5 * 60_000, bans: 3 * 60_000 } as const;

const DEADLINE_SETTINGS = 'phase:settings';
const DEADLINE_BANS = 'phase:bans';

// ── State model ──────────────────────────────────────────────────────────────

export interface RoomConfig {
  edition: CivEdition; // engine vocab 'CIV6' | 'CIV7'; `game` is derived from this
  source: 'activity' | 'command';
  mode: string; // §B.1 mode — launcher passthrough
  gameType: DraftGameType;
  numberTeams?: number;
  startingAge?: Civ7StartingAge;
  guildId: string;
  hostId: string;
  voiceChannelId?: string;
  voteConfig: GameVoteConfig; // launcher-supplied questions (incl. 'map', 'draft_mode')
  seasonId?: string; // stamped at R5.5
  timers?: Partial<EngineDraftTimersMs>;
  phaseTimersMs?: { settings?: number; bans?: number };
}

export interface SeatMember {
  userId: string;
  seatIndex: number;
  team?: number;
  ready: boolean; // per-phase "I'm done" / "+"; reset on every phase transition
}

export interface SettingsSubState {
  ballots: Record<string, Record<string, string>>; // questionId → (userId → encoded selection)
  locked: Record<string, string> | null; // questionId → winning optionId (after phase exit)
  tiebreaks: QuestionTiebreak[];
}

export interface BansSubState {
  submissions: Record<string, { leaderKeys: string[]; civKeys: string[] }>;
  resolvedLeaderKeys: string[] | null;
  resolvedCivKeys: string[] | null;
}

export type DraftSubState =
  | { kind: 'none' }
  | { kind: 'instant'; result: Civ6DraftResult | Civ7DraftResult }
  | { kind: 'interactive'; state: DraftSessionState };

export interface RoomRecord {
  id: string;
  version: number;
  phase: SessionPhase;
  config: RoomConfig;
  members: Record<string, SeatMember>;
  settings: SettingsSubState;
  bans: BansSubState;
  draft: DraftSubState;
  draftType: DraftFormatId | null; // resolved format used for the draft (telemetry)
  deadline: { token: string; at: number } | null; // single active deadline
  startedAt: number | null; // draft-phase entry
  createdAt: number;
  completedAt: number | null;
  cancelledAt: number | null;
  cancelReason: string | null;
}

// ── Command / Effect / Response contracts ───────────────────────────────────

export type SessionCommand =
  | { type: 'JOIN'; userId: string; team?: number; expectedVersion?: number }
  | { type: 'LEAVE'; userId: string; expectedVersion?: number }
  | { type: 'SET_READY'; userId: string; ready: boolean; expectedVersion?: number }
  | { type: 'CAST_VOTE'; userId: string; questionId: string; optionIds: readonly string[]; expectedVersion?: number }
  | { type: 'RANDOMIZE_BALLOT'; userId: string; expectedVersion?: number }
  | { type: 'CAST_BAN'; userId: string; leaderKeys: readonly string[]; civKeys: readonly string[]; expectedVersion?: number }
  | { type: 'ADVANCE'; byUserId: string; expectedVersion?: number }
  | { type: 'STAGE_PICK'; userId: string; pickType: 'leader' | 'civ'; key: string; turnToken?: number; expectedVersion?: number }
  | { type: 'SUBMIT_PICK'; userId: string; turnToken?: number; expectedVersion?: number }
  | { type: 'PICK'; userId: string; key: string; turnToken: number; expectedVersion?: number }
  | { type: 'SELECT_CAPTAIN'; byUserId: string; teamIndex: 0 | 1; userId: string; expectedVersion?: number }
  | { type: 'TIMEOUT'; token: string }
  | { type: 'CANCEL'; reason: string; byUserId?: string; expectedVersion?: number };

export type SessionEffect =
  | { type: 'STATE_CHANGED'; room: RoomRecord; events: readonly DraftEngineEvent[] }
  | { type: 'SET_DEADLINE'; token: string; at: number }
  | { type: 'CLEAR_DEADLINE' }
  | { type: 'NOTIFY'; target: 'public' | { userId: string }; message: string }
  | { type: 'TELEMETRY'; record: DraftTelemetryRecord }
  | { type: 'SESSION_CLOSED'; reason: string; reportingToken: string | null };

export type RejectCode =
  | 'STALE_VERSION'
  | 'WRONG_PHASE'
  | 'NOT_MEMBER'
  | 'NOT_HOST'
  | 'ALREADY_MEMBER'
  | 'SESSION_FULL'
  | 'NOT_ENOUGH_PLAYERS'
  | 'LOCKED'
  | 'INVALID_OPTION'
  | 'ENGINE_REJECTED'
  | 'SETUP_FAILED'
  | 'INACTIVE';

export type CommandResponse = { ok: true } | { ok: false; code: RejectCode; message: string };
export interface RoomTransition {
  room: RoomRecord;
  effects: SessionEffect[];
  response: CommandResponse;
}

export interface SessionDeps {
  now: () => number;
  rng: RandomSource;
}

// ── Factory + rehydrator ────────────────────────────────────────────────────

export function createRoomRecord(params: { id: string; config: RoomConfig; createdAt: number }): RoomRecord {
  return {
    id: params.id,
    version: 0,
    phase: 'lobby',
    config: params.config,
    members: {},
    settings: { ballots: {}, locked: null, tiebreaks: [] },
    bans: { submissions: {}, resolvedLeaderKeys: null, resolvedCivKeys: null },
    draft: { kind: 'none' },
    draftType: null,
    deadline: null,
    startedAt: null,
    createdAt: params.createdAt,
    completedAt: null,
    cancelledAt: null,
    cancelReason: null,
  };
}

/** Defensive rehydrator (civup pattern). Reconstructs a well-formed record or null. Used by R5.4. */
export function normalizeRoomRecord(value: unknown): RoomRecord | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Partial<RoomRecord>;
  if (typeof v.id !== 'string' || typeof v.version !== 'number') return null;
  if (v.phase === undefined || !SESSION_PHASES.includes(v.phase)) return null;
  if (typeof v.config !== 'object' || v.config === null) return null;
  return {
    id: v.id,
    version: v.version,
    phase: v.phase,
    config: v.config,
    members: v.members ?? {},
    settings: v.settings ?? { ballots: {}, locked: null, tiebreaks: [] },
    bans: v.bans ?? { submissions: {}, resolvedLeaderKeys: null, resolvedCivKeys: null },
    draft: v.draft ?? { kind: 'none' },
    draftType: v.draftType ?? null,
    deadline: v.deadline ?? null,
    startedAt: v.startedAt ?? null,
    createdAt: typeof v.createdAt === 'number' ? v.createdAt : 0,
    completedAt: v.completedAt ?? null,
    cancelledAt: v.cancelledAt ?? null,
    cancelReason: v.cancelReason ?? null,
  };
}

// ── Reducer entrypoint ───────────────────────────────────────────────────────

export function processSessionCommand(room: RoomRecord, command: SessionCommand, deps: SessionDeps): RoomTransition {
  if ('expectedVersion' in command && command.expectedVersion !== undefined && command.expectedVersion !== room.version) {
    return reject(room, 'STALE_VERSION', `expected version ${command.expectedVersion}, current ${room.version}`);
  }

  switch (command.type) {
    case 'CANCEL':
      return finalize(handleCancel(room, command, deps), room);
    case 'TIMEOUT':
      return finalize(handleTimeout(room, command, deps), room);
    case 'JOIN':
      return finalize(handleJoin(room, command), room);
    case 'LEAVE':
      return finalize(handleLeave(room, command), room);
    case 'SET_READY':
      return finalize(handleSetReady(room, command, deps), room);
    case 'CAST_VOTE':
      return finalize(handleCastVote(room, command), room);
    case 'RANDOMIZE_BALLOT':
      return finalize(handleRandomizeBallot(room, command, deps), room);
    case 'CAST_BAN':
      return finalize(handleCastBan(room, command), room);
    case 'ADVANCE':
      return finalize(handleAdvance(room, command, deps), room);
    case 'STAGE_PICK':
    case 'SUBMIT_PICK':
    case 'PICK':
    case 'SELECT_CAPTAIN':
      return finalize(handleDraftInput(room, command, deps), room);
    default:
      return assertNever(command);
  }
}

/** Bump `version` only on an accepted command that actually produced a new record. */
function finalize(result: RoomTransition, base: RoomRecord): RoomTransition {
  if (result.response.ok && result.room !== base) {
    result.room.version = base.version + 1;
  }
  return result;
}

// ── Lobby ────────────────────────────────────────────────────────────────────

function handleJoin(base: RoomRecord, cmd: Extract<SessionCommand, { type: 'JOIN' }>): RoomTransition {
  if (base.phase !== 'lobby') return reject(base, 'WRONG_PHASE', 'can only join in the lobby');
  if (base.members[cmd.userId]) return reject(base, 'ALREADY_MEMBER', 'already seated');
  if (seatCount(base) >= MAX_SEATS) return reject(base, 'SESSION_FULL', 'session is full');
  const next = clone(base);
  next.members[cmd.userId] = { userId: cmd.userId, seatIndex: seatCount(base), ready: false, team: cmd.team };
  return commit(next, [stateChanged(next)]);
}

function handleLeave(base: RoomRecord, cmd: Extract<SessionCommand, { type: 'LEAVE' }>): RoomTransition {
  if (base.phase !== 'lobby') return reject(base, 'WRONG_PHASE', 'can only leave in the lobby');
  if (!base.members[cmd.userId]) return reject(base, 'NOT_MEMBER', 'not seated');
  const next = clone(base);
  delete next.members[cmd.userId];
  recompactSeats(next);
  return commit(next, [stateChanged(next)]);
}

// ── Readiness + auto-advance ──────────────────────────────────────────────────

function handleSetReady(base: RoomRecord, cmd: Extract<SessionCommand, { type: 'SET_READY' }>, deps: SessionDeps): RoomTransition {
  const member = base.members[cmd.userId];
  if (!member) return reject(base, 'NOT_MEMBER', 'not seated');
  if (base.phase !== 'lobby' && base.phase !== 'settings' && base.phase !== 'bans') {
    return reject(base, 'WRONG_PHASE', 'nothing to ready in this phase');
  }
  const next = clone(base);
  next.members[cmd.userId].ready = cmd.ready;
  if (cmd.ready) {
    const advanced = maybeAutoAdvance(next, deps);
    if (advanced) return advanced;
  }
  return commit(next, [stateChanged(next)]);
}

/** If all seats are ready (and preconditions hold), advance the current phase. */
function maybeAutoAdvance(next: RoomRecord, deps: SessionDeps): RoomTransition | null {
  if (!allSeatsReady(next)) return null;
  switch (next.phase) {
    case 'lobby':
      return seatCount(next) >= MIN_SEATS_TO_START ? advanceLobbyToSettings(next, deps) : null;
    case 'settings':
      return advanceSettingsToBans(next, deps);
    case 'bans':
      return advanceBansToDraft(next, deps);
    default:
      return null;
  }
}

// ── Host-driven advance ───────────────────────────────────────────────────────

function handleAdvance(base: RoomRecord, cmd: Extract<SessionCommand, { type: 'ADVANCE' }>, deps: SessionDeps): RoomTransition {
  if (cmd.byUserId !== base.config.hostId) return reject(base, 'NOT_HOST', 'only the host can advance');
  switch (base.phase) {
    case 'lobby':
      if (seatCount(base) < MIN_SEATS_TO_START) return reject(base, 'NOT_ENOUGH_PLAYERS', `need at least ${MIN_SEATS_TO_START} players`);
      return advanceLobbyToSettings(clone(base), deps);
    case 'settings':
      return advanceSettingsToBans(clone(base), deps);
    case 'bans':
      return advanceBansToDraft(clone(base), deps);
    default:
      return reject(base, 'WRONG_PHASE', 'cannot advance from this phase');
  }
}

// ── Phase transitions (operate on an already-cloned `next`) ──────────────────

function advanceLobbyToSettings(next: RoomRecord, deps: SessionDeps): RoomTransition {
  next.phase = 'settings';
  resetReady(next);
  const at = deps.now() + phaseTimer(next.config, 'settings');
  next.deadline = { token: DEADLINE_SETTINGS, at };
  return commit(next, [setDeadline(DEADLINE_SETTINGS, at), stateChanged(next)]);
}

function advanceSettingsToBans(next: RoomRecord, deps: SessionDeps): RoomTransition {
  const { locked, tiebreaks } = resolveSettings(next);
  next.settings.locked = locked;
  next.settings.tiebreaks = tiebreaks;
  next.phase = 'bans';
  resetReady(next);
  const at = deps.now() + phaseTimer(next.config, 'bans');
  next.deadline = { token: DEADLINE_BANS, at };
  return commit(next, [setDeadline(DEADLINE_BANS, at), stateChanged(next)]);
}

function advanceBansToDraft(next: RoomRecord, deps: SessionDeps): RoomTransition {
  const { resolvedLeaderKeys, resolvedCivKeys } = resolveBans(next);
  next.bans.resolvedLeaderKeys = resolvedLeaderKeys;
  next.bans.resolvedCivKeys = resolvedCivKeys;
  resetReady(next);
  return enterDraft(next, deps);
}

function enterDraft(next: RoomRecord, deps: SessionDeps): RoomTransition {
  const draftType = resolveDraftType(next);
  next.draftType = draftType;
  next.phase = 'draft';
  next.startedAt = deps.now();
  const cfg = buildDraftConfig(next);

  try {
    if (getDraftFormat(draftType).kind === 'instant') {
      const result = resolveVoteStandardDraft(cfg, deps.rng);
      next.draft = { kind: 'instant', result };
      return completeDraft(next, deps, []);
    }
    const creation = createDraftSession(draftType as InteractiveDraftKind, cfg, deps.rng);
    next.draft = { kind: 'interactive', state: creation.state };
    const effects: SessionEffect[] = [];
    applyDeadline(next, deadlineFromEvents(creation.events, deps.now()), effects);
    effects.push(stateChanged(next, creation.events));
    return commit(next, effects);
  } catch (err) {
    if (err instanceof DraftError) return cancelSetupFailed(next, deps, err.message);
    throw err;
  }
}

function completeDraft(next: RoomRecord, deps: SessionDeps, events: readonly DraftEngineEvent[]): RoomTransition {
  next.phase = 'complete';
  next.completedAt = deps.now();
  next.deadline = null;
  const record = buildDraftRecord(next);
  const token = buildReportingToken(next);
  return commit(next, [clearDeadline(), stateChanged(next, events), telemetryEffect(record), sessionClosed('complete', token)]);
}

function cancelSetupFailed(next: RoomRecord, deps: SessionDeps, message: string): RoomTransition {
  next.phase = 'cancelled';
  next.cancelledAt = deps.now();
  next.cancelReason = 'setup-failed';
  next.deadline = null;
  return commit(next, [clearDeadline(), notify('public', message), stateChanged(next), sessionClosed('setup-failed', null)]);
}

// ── Settings phase (voting) ───────────────────────────────────────────────────

function handleCastVote(base: RoomRecord, cmd: Extract<SessionCommand, { type: 'CAST_VOTE' }>): RoomTransition {
  if (base.phase !== 'settings') return reject(base, 'WRONG_PHASE', 'voting is closed');
  const member = base.members[cmd.userId];
  if (!member) return reject(base, 'NOT_MEMBER', 'not seated');
  if (member.ready) return reject(base, 'LOCKED', 'your ballot is locked');
  const question = findQuestion(base.config, cmd.questionId);
  if (!question) return reject(base, 'INVALID_OPTION', 'unknown question');

  const encoded = encodeVoteSelections(question, cmd.optionIds);
  if (encoded === null && cmd.optionIds.length > 0) return reject(base, 'INVALID_OPTION', 'no valid options selected');

  const next = clone(base);
  if (encoded === null) {
    // empty selection → clear this seat's vote for the question
    const bucket = next.settings.ballots[cmd.questionId];
    if (bucket) delete bucket[cmd.userId];
  } else {
    (next.settings.ballots[cmd.questionId] ??= {})[cmd.userId] = encoded;
  }
  return commit(next, [stateChanged(next)]);
}

function handleRandomizeBallot(base: RoomRecord, cmd: Extract<SessionCommand, { type: 'RANDOMIZE_BALLOT' }>, deps: SessionDeps): RoomTransition {
  if (base.phase !== 'settings') return reject(base, 'WRONG_PHASE', 'voting is closed');
  const member = base.members[cmd.userId];
  if (!member) return reject(base, 'NOT_MEMBER', 'not seated');
  if (member.ready) return reject(base, 'LOCKED', 'your ballot is locked');

  const next = clone(base);
  for (const question of next.config.voteConfig.questions) {
    const existing = next.settings.ballots[question.id]?.[cmd.userId];
    if (existing === undefined) {
      (next.settings.ballots[question.id] ??= {})[cmd.userId] = pickRandomVoteValue(question, deps.rng);
    }
  }
  return commit(next, [stateChanged(next)]);
}

// ── Bans phase ─────────────────────────────────────────────────────────────

function handleCastBan(base: RoomRecord, cmd: Extract<SessionCommand, { type: 'CAST_BAN' }>): RoomTransition {
  if (base.phase !== 'bans') return reject(base, 'WRONG_PHASE', 'bans are closed');
  const member = base.members[cmd.userId];
  if (!member) return reject(base, 'NOT_MEMBER', 'not seated');
  if (member.ready) return reject(base, 'LOCKED', 'your bans are locked');
  const next = clone(base);
  next.bans.submissions[cmd.userId] = { leaderKeys: [...cmd.leaderKeys], civKeys: [...cmd.civKeys] };
  return commit(next, [stateChanged(next)]);
}

// ── Draft phase (delegates to the engine) ────────────────────────────────────

function handleDraftInput(
  base: RoomRecord,
  cmd: Extract<SessionCommand, { type: 'STAGE_PICK' | 'SUBMIT_PICK' | 'PICK' | 'SELECT_CAPTAIN' }>,
  deps: SessionDeps,
): RoomTransition {
  if (base.phase !== 'draft' || base.draft.kind !== 'interactive') return reject(base, 'WRONG_PHASE', 'no draft in progress');
  const result = processDraftInput(base.draft.state, toEngineInput(cmd), deps.rng);
  if (isDraftInputError(result)) return reject(base, 'ENGINE_REJECTED', result.error.message);
  return applyDraftResult(base, result.state, result.events, deps);
}

/** Common tail for engine results (pick or draft-timeout): update state, advance/complete/keep. */
function applyDraftResult(base: RoomRecord, state: DraftSessionState, events: readonly DraftEngineEvent[], deps: SessionDeps): RoomTransition {
  const next = clone(base);
  next.draft = { kind: 'interactive', state };
  if (state.status === 'complete') return completeDraft(next, deps, events);
  const effects: SessionEffect[] = [];
  applyDeadline(next, deadlineFromEvents(events, deps.now()), effects);
  effects.push(stateChanged(next, events));
  return commit(next, effects);
}

function toEngineInput(cmd: Extract<SessionCommand, { type: 'STAGE_PICK' | 'SUBMIT_PICK' | 'PICK' | 'SELECT_CAPTAIN' }>): DraftEngineInput {
  switch (cmd.type) {
    case 'STAGE_PICK':
      return { type: 'STAGE', seatId: cmd.userId, pickType: cmd.pickType, key: cmd.key, turnToken: cmd.turnToken };
    case 'SUBMIT_PICK':
      return { type: 'SUBMIT', seatId: cmd.userId, turnToken: cmd.turnToken };
    case 'PICK':
      return { type: 'PICK', seatId: cmd.userId, key: cmd.key, turnToken: cmd.turnToken };
    case 'SELECT_CAPTAIN':
      return { type: 'SELECT_CAPTAIN', byUserId: cmd.byUserId, teamIndex: cmd.teamIndex, userId: cmd.userId };
    default:
      return assertNever(cmd);
  }
}

// ── Timeout (single active deadline; stale-token guard) ──────────────────────

function handleTimeout(base: RoomRecord, cmd: Extract<SessionCommand, { type: 'TIMEOUT' }>, deps: SessionDeps): RoomTransition {
  // stale/superseded token → accept as a no-op (unchanged record, no version bump)
  if (!base.deadline || cmd.token !== base.deadline.token) return commit(base, []);

  switch (base.phase) {
    case 'settings':
      return advanceSettingsToBans(clone(base), deps);
    case 'bans':
      return advanceBansToDraft(clone(base), deps);
    case 'draft': {
      if (base.draft.kind !== 'interactive') return commit(base, []);
      const result = processDraftInput(base.draft.state, { type: 'TIMEOUT' }, deps.rng);
      if (isDraftInputError(result)) return commit(base, []);
      return applyDraftResult(base, result.state, result.events, deps);
    }
    default:
      return commit(base, []);
  }
}

// ── Cancel (host, cross-phase) ────────────────────────────────────────────────

function handleCancel(base: RoomRecord, cmd: Extract<SessionCommand, { type: 'CANCEL' }>, deps: SessionDeps): RoomTransition {
  if (base.phase === 'complete' || base.phase === 'cancelled') return reject(base, 'INACTIVE', 'session already ended');
  if (cmd.byUserId !== undefined && cmd.byUserId !== base.config.hostId) return reject(base, 'NOT_HOST', 'only the host can cancel');

  const next = clone(base);
  if (base.phase === 'draft' && base.draft.kind === 'interactive' && base.draft.state.status === 'active') {
    const result = processDraftInput(base.draft.state, { type: 'CANCEL', reason: cmd.reason }, deps.rng);
    if (!isDraftInputError(result)) next.draft = { kind: 'interactive', state: result.state };
  }
  next.phase = 'cancelled';
  next.cancelledAt = deps.now();
  next.cancelReason = cmd.reason;
  next.deadline = null;
  return commit(next, [clearDeadline(), stateChanged(next), sessionClosed('cancelled', null)]);
}

// ── Resolution helpers ───────────────────────────────────────────────────────

/**
 * Resolve every settings question with A2 semantics: only seats that voted count, the voters
 * decide, zero votes → default, ties broken deterministically. Achieved by calling the engine
 * resolver with `voterIds` set to the submitters, which disables its legacy "all must vote → default"
 * guard and runs the real approval/plurality path. (Verified against the real engine.)
 */
function resolveSettings(next: RoomRecord): { locked: Record<string, string>; tiebreaks: QuestionTiebreak[] } {
  const locked: Record<string, string> = {};
  const tiebreaks: QuestionTiebreak[] = [];
  for (const question of next.config.voteConfig.questions) {
    const record = new Map(Object.entries(next.settings.ballots[question.id] ?? {}));
    const submitters = [...record.keys()];
    const outcome = resolveQuestionWinner(next.id, question, record, submitters);
    locked[question.id] = outcome.winnerId;
    if (outcome.tiebreak) tiebreaks.push(outcome.tiebreak);
  }
  return { locked, tiebreaks };
}

/** Resolve bans by majority of ALL seats (D13 parity). Civ bans only exist for CIV7. */
function resolveBans(next: RoomRecord): { resolvedLeaderKeys: string[]; resolvedCivKeys: string[] } {
  const seatIds = seatOrder(next);
  const perLeader = new Map<string, Set<string>>();
  const perCiv = new Map<string, Set<string>>();
  for (const [userId, submission] of Object.entries(next.bans.submissions)) {
    if (submission.leaderKeys.length) perLeader.set(userId, new Set(submission.leaderKeys));
    if (submission.civKeys.length) perCiv.set(userId, new Set(submission.civKeys));
  }
  return {
    resolvedLeaderKeys: [...majorityBans(seatIds, perLeader)],
    resolvedCivKeys: next.config.edition === 'CIV7' ? [...majorityBans(seatIds, perCiv)] : [],
  };
}

/** Winning draft_mode option → a legal format for the game type; falls back to always-legal 'standard'. */
function resolveDraftType(next: RoomRecord): DraftFormatId {
  const raw = next.settings.locked?.['draft_mode'];
  const candidate = DRAFT_FORMATS.find((format) => format.id === raw)?.id;
  if (candidate && isDraftFormatAllowed(candidate, next.config.gameType)) return candidate;
  return 'standard';
}

function buildDraftConfig(next: RoomRecord): DraftSessionConfig {
  return {
    sessionId: next.id,
    voteUuid: next.id,
    edition: next.config.edition,
    startingAge: next.config.startingAge,
    gameType: next.config.gameType,
    numberTeams: next.config.numberTeams,
    hostId: next.config.hostId,
    seatIds: seatOrder(next),
    bannedLeaderKeys: next.bans.resolvedLeaderKeys ?? [],
    bannedCivKeys: next.bans.resolvedCivKeys ?? [],
    timers: next.config.timers,
  };
}

// ── Deadline derivation from engine events ───────────────────────────────────

type DeadlineChange = { kind: 'set'; token: string; at: number } | { kind: 'clear' } | { kind: 'keep' };

function deadlineFromEvents(events: readonly DraftEngineEvent[], now: number): DeadlineChange {
  for (const event of events) {
    if (event.type === 'DRAFT_COMPLETED' || event.type === 'SESSION_CLOSED_NO_POOL' || event.type === 'DRAFT_CANCELLED') {
      return { kind: 'clear' };
    }
  }
  let change: DeadlineChange = { kind: 'keep' };
  for (const event of events) {
    if (event.type === 'TURN_STARTED') change = { kind: 'set', token: `turn:${event.turnToken}`, at: now + event.durationMs };
    else if (event.type === 'DEADLINE_SET') change = { kind: 'set', token: `phase:${event.deadlineKind}`, at: now + event.durationMs };
  }
  return change;
}

function applyDeadline(next: RoomRecord, change: DeadlineChange, effects: SessionEffect[]): void {
  if (change.kind === 'set') {
    next.deadline = { token: change.token, at: change.at };
    effects.push(setDeadline(change.token, change.at));
  } else if (change.kind === 'clear') {
    next.deadline = null;
    effects.push(clearDeadline());
  }
}

// ── Small helpers ─────────────────────────────────────────────────────────────

function seatCount(room: RoomRecord): number {
  return Object.keys(room.members).length;
}
function seatOrder(room: RoomRecord): string[] {
  return Object.values(room.members)
    .sort((a, b) => a.seatIndex - b.seatIndex)
    .map((m) => m.userId);
}
function allSeatsReady(room: RoomRecord): boolean {
  const seats = Object.values(room.members);
  return seats.length > 0 && seats.every((m) => m.ready);
}
function resetReady(room: RoomRecord): void {
  for (const member of Object.values(room.members)) member.ready = false;
}
function recompactSeats(room: RoomRecord): void {
  Object.values(room.members)
    .sort((a, b) => a.seatIndex - b.seatIndex)
    .forEach((member, index) => {
      member.seatIndex = index;
    });
}
function findQuestion(config: RoomConfig, id: string): VoteQuestion | undefined {
  return config.voteConfig.questions.find((question) => question.id === id);
}
function phaseTimer(config: RoomConfig, phase: 'settings' | 'bans'): number {
  return config.phaseTimersMs?.[phase] ?? DEFAULT_PHASE_TIMERS_MS[phase];
}
function clone(room: RoomRecord): RoomRecord {
  return structuredClone(room);
}

// ── Effect + transition builders ──────────────────────────────────────────────

function stateChanged(room: RoomRecord, events: readonly DraftEngineEvent[] = []): SessionEffect {
  return { type: 'STATE_CHANGED', room, events };
}
function setDeadline(token: string, at: number): SessionEffect {
  return { type: 'SET_DEADLINE', token, at };
}
function clearDeadline(): SessionEffect {
  return { type: 'CLEAR_DEADLINE' };
}
function notify(target: 'public' | { userId: string }, message: string): SessionEffect {
  return { type: 'NOTIFY', target, message };
}
function telemetryEffect(record: DraftTelemetryRecord): SessionEffect {
  return { type: 'TELEMETRY', record };
}
function sessionClosed(reason: string, reportingToken: string | null): SessionEffect {
  return { type: 'SESSION_CLOSED', reason, reportingToken };
}
function commit(room: RoomRecord, effects: SessionEffect[], response: CommandResponse = { ok: true }): RoomTransition {
  return { room, effects, response };
}
function reject(room: RoomRecord, code: RejectCode, message: string): RoomTransition {
  return { room, effects: [], response: { ok: false, code, message } };
}
function assertNever(value: never): never {
  throw new Error(`unhandled session command: ${JSON.stringify(value)}`);
}
