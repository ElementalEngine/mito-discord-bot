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

/** Scaffold flag imported by tests/smoke.test.ts; */
export const SESSION_SCAFFOLD = true as const;
