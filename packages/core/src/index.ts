// The transport error codes and the envelope they travel in. Types only, so the
// package needs no build; the parsing lives with its consumer in apps/bot.

// The eight transport codes. Other features send codes of their own, so the
// payload's `code` is a string rather than this union.
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
  /** An ApiErrorCode, or a feature's own code. */
  code: string;
  message: string;
  details?: unknown;
  /** False means never retry, whatever the status; the client decides, not a call site. */
  retryable: boolean;
  correlation_id?: string | null;
};

// core-api sends the first shape; the second is the bare form Lady Justice also accepts.
export type ApiErrorEnvelope =
  | { detail: { error: ApiErrorPayload } }
  | { error: ApiErrorPayload };
