// The error core-api sends. Types only, so the package needs no build; the
// parsing lives with its consumer in apps/bot.

/** The error object itself, whichever envelope carried it. */
export type ApiErrorPayload = {
  /** A transport code such as NOT_FOUND or UNAVAILABLE, or a feature's own code. */
  code: string;
  message: string;
  details?: unknown;
  /** False means never retry, whatever the status; the client decides, not a call site. */
  retryable: boolean;
  correlation_id?: string | null;
};
