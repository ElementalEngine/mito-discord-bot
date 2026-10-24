import type { ApiErrorPayload } from "@cpl/core";

// Reads core-api's error envelope, `{detail:{error}}` or a bare `{error}`, or null.
// A half-envelope is null too: `retryable` decides a retry and is never guessed.
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
  /** Both present only when the response carried an error envelope. */
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
