/**
 * Activity transport public surface.
 * R6.1: auth (tokens + admission) + config.
 * R6.2: hub (fan-out/censoring) + ws/express server + protocol.
 * R6.3 adds the smoke page; R6.4 the dev launch bridge.
 */
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

export { createDevRouter } from './dev.js';
export { SMOKE_PAGE_HTML } from './smoke-page.js';
export { buildDevConfig, normalizeEdition, normalizeGameType, normalizeDraftMode, DEV_DRAFT_MODES } from './dev-config.js';
export type { DevDraftMode, DevSessionParams } from './dev-config.js';

export const ACTIVITY_SCAFFOLD = true as const;
