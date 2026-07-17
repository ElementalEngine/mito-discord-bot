export {
  createIdentityToken,
  createRoomAccessToken,
  verifyIdentityToken,
  verifyRoomAccessToken,
} from './auth/tokens.js';
export type {
  IdentityClaims,
  RoomAccessClaims,
  TokenFailure,
  VerifyResult,
} from './auth/tokens.js';

export { admitConnection } from './auth/admission.js';
export type { AdmissionInput, AdmissionResult, AdmissionRefusal } from './auth/admission.js';

export { activityConfig, validateActivityConfig } from './config.js';

export { ActivityHub, createDetachedActor } from './hub.js';
export type { HubConnection, ActivityHubOptions } from './hub.js';

export { parseClientMessage, toSessionCommand } from './protocol.js';
export type { ServerMessage, ParseResult, ParseFailure } from './protocol.js';

export { createActivityServer } from './server.js';
export type { ActivityServer } from './server.js';

export { startActivity } from './start.js';

/** Scaffold flag imported by tests/smoke.test.ts; removed at R9. */
export const ACTIVITY_SCAFFOLD = true as const;
