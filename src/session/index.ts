export {
  SESSION_PHASES,
  createRoomRecord,
  normalizeRoomRecord,
  processSessionCommand,
} from './domain.js';
export type {
  SessionPhase,
  RoomConfig,
  SeatMember,
  SettingsSubState,
  BansSubState,
  DraftSubState,
  RoomRecord,
  SessionCommand,
  SessionEffect,
  RejectCode,
  CommandResponse,
  RoomTransition,
  SessionDeps,
} from './domain.js';

export { projectRoom, projectEvents } from './projection.js';
export type { Recipient, PublicConfig, RoomSnapshot, ProjectionResult } from './projection.js';

export { buildDraftRecord, buildReportingToken } from './telemetry.js';

export { createDeadlineRegistry, createSystemClock } from './timers.js';
export type { Clock, Deadline, DeadlineRegistry } from './timers.js';

export { createSessionActor, SessionActorDirectory } from './actor.js';
export type { SessionActor, EffectExecutor } from './actor.js';

/** Scaffold flag imported by tests/smoke.test.ts; removed at R9. */
export const SESSION_SCAFFOLD = true as const;
