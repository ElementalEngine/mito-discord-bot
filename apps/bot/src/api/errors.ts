import type { ApiErrorPayload } from "@cpl/core";

/**
 * Reads D92's error envelope off a response body, or returns null.
 *
 * Two shapes are accepted: core-api sends `{detail:{error}}`, and the bare
 * `{error}` is what LadyJustice already tolerates for forward compatibility.
 * Matching that here costs one `??` and keeps both clients reading the wire
 * the same way.
 *
 * Null is the common case today, and deliberately so: Mite calls /api/v1,
 * where matches and stats raise HTTPException(400, str(exc)) with no
 * envelope at all. A caller that gets null has learned nothing about
 * retryability and must fall back to the transport rule (D93).
 *
 * Both `code` and `retryable` are required. A half-envelope is treated as
 * no envelope rather than guessed at -- `retryable` drives a real decision
 * and defaulting it either way would be inventing contract.
 */
export function parseApiError(body: unknown): ApiErrorPayload | null {
  if (typeof body !== "object" || body === null) return null;

  const outer = body as { detail?: unknown; error?: unknown };
  const detail =
    typeof outer.detail === "object" && outer.detail !== null
      ? (outer.detail as { error?: unknown })
      : undefined;

  const raw = detail?.error ?? outer.error;
  if (typeof raw !== "object" || raw === null) return null;

  const error = raw as Record<string, unknown>;
  if (typeof error.code !== "string") return null;
  if (typeof error.retryable !== "boolean") return null;

  return {
    code: error.code,
    message: typeof error.message === "string" ? error.message : "",
    details: error.details,
    retryable: error.retryable,
    correlation_id:
      typeof error.correlation_id === "string" ? error.correlation_id : null,
  };
}

export class ApiError extends Error {
  status: number;
  body?: unknown;
  /** Both present only when the response carried a D92 envelope. */
  code?: string;
  retryable?: boolean;

  constructor(message: string, status: number, body?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;

    const payload = parseApiError(body);
    if (payload) {
      this.code = payload.code;
      this.retryable = payload.retryable;
    }
  }
}
