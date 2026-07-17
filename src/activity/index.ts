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

/** Scaffold flag imported by tests/smoke.test.ts; removed at R9. */
export const ACTIVITY_SCAFFOLD = true as const;