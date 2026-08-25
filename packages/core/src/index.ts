/**
 * D92's closed transport enum and the envelope it travels in.
 *
 * Types only, like @cpl/contracts: a union gives exhaustive branching and
 * compile-checked comparisons with no runtime value, so this package needs
 * no build step and nothing has to be emitted or linked at runtime. The
 * parsing that reads an envelope off a response is runtime code and lives
 * with its consumer in apps/bot/src/api/errors.ts.
 */

/**
 * The eight transport codes. Closed on the surfaces D92 governs -- the
 * matches and stats v2 routers, plus the app-wide handlers answering for
 * them. Auth, infractions and civdata emit feature-specific codes of their
 * own, which C10 freezes; hence `code: string` on the payload below rather
 * than a union that would be a lie about what can arrive.
 */
export type ApiErrorCode =
  | 'INVALID_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'UNAVAILABLE'
  | 'INTERNAL';

/** The error object itself, whichever envelope carried it. */
export type ApiErrorPayload = {
  /** An ApiErrorCode on D92's surfaces; a feature code elsewhere. */
  code: string;
  message: string;
  details?: unknown;
  /**
   * Contract-level, not advisory. False means never retry, whatever the
   * status says; the client honours it and never decides per call site.
   */
  retryable: boolean;
  correlation_id?: string | null;
};

/**
 * Two shapes. core-api sends the first; the second is what LadyJustice
 * already tolerates for forward compatibility, and matching it here costs
 * one `??` and keeps the two clients reading the wire the same way.
 */
export type ApiErrorEnvelope =
  | { detail: { error: ApiErrorPayload } }
  | { error: ApiErrorPayload };
