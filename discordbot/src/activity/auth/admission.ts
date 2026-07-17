import { projectRoom } from '../../session/index.js';
import type { RoomRecord, Recipient } from '../../session/index.js';
import { verifyIdentityToken, verifyRoomAccessToken } from './tokens.js';
import type { IdentityClaims, TokenFailure } from './tokens.js';

export type AdmissionRefusal =
  | { kind: 'unauthenticated'; reason: TokenFailure } // identity token invalid
  | { kind: 'forbidden'; reason: TokenFailure } // room-access token invalid / unbound
  | { kind: 'observer-forbidden' } // unseated + not staff
  | { kind: 'observer-is-seated' }; // projection refused a seated god-view (defense-in-depth)

export type AdmissionResult =
  | { ok: true; recipient: Recipient; identity: IdentityClaims }
  | { ok: false; refusal: AdmissionRefusal };

export interface AdmissionInput {
  secret: string | undefined;
  room: RoomRecord;
  identityToken: string | null | undefined;
  roomAccessToken: string | null | undefined;
  /** Injectable clock for tests; defaults to Date.now() inside the token verifiers. */
  nowMs?: number;
}

export function admitConnection(input: AdmissionInput): AdmissionResult {
  const { secret, room, identityToken, roomAccessToken, nowMs } = input;

  // 1. Identity — who are you?
  const identityResult = verifyIdentityToken(secret, identityToken, { nowMs });
  if (!identityResult.ok) {
    return refuse({ kind: 'unauthenticated', reason: identityResult.reason });
  }
  const identity = identityResult.claims;

  // 2. Room access — may you reach this session at all? (bound to sub + sessionId)
  const accessResult = verifyRoomAccessToken(
    secret,
    roomAccessToken,
    { userId: identity.sub, sessionId: room.id },
    { nowMs },
  );
  if (!accessResult.ok) {
    return refuse({ kind: 'forbidden', reason: accessResult.reason });
  }

  // 3. Seat check FIRST — seated users always get the (censored) seat view.
  const seated = room.members[identity.sub] !== undefined;
  const recipient: Recipient = seated
    ? { kind: 'seat', seatId: identity.sub }
    : { kind: 'observer', userId: identity.sub };

  // 4. Unseated non-staff: allowed ONLY during the lobby (so they can JOIN a seat).
  if (!seated && identity.staff !== true && room.phase !== 'lobby') {
    return refuse({ kind: 'observer-forbidden' });
  }

  // 5. Defense-in-depth: the projection layer is the final K7 authority.
  const projection = projectRoom(room, recipient);
  if ('error' in projection) {
    return refuse({ kind: 'observer-is-seated' });
  }

  return { ok: true, recipient, identity };
}

function refuse(refusal: AdmissionRefusal): AdmissionResult {
  return { ok: false, refusal };
}
