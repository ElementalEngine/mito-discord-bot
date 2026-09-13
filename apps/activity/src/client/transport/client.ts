export type Fetch = typeof fetch;
export type TokenStore = { get(): string | null; set(token: string): void };

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(`${status} ${code}`);
  }
}
export class SessionExpired extends Error {}

export type Reply<T> = { status: number; body: T | null };

// Reads either envelope shape: core-api's {detail: {error}} or the bare {error}.
function envelope(body: unknown): { code: string; retryable: boolean } | null {
  if (typeof body !== 'object' || body === null) return null;
  const outer = body as { detail?: { error?: unknown }; error?: unknown };
  const error = outer.detail?.error ?? outer.error;
  if (typeof error !== 'object' || error === null) return null;
  const e = error as { code?: unknown; retryable?: unknown };
  return typeof e.code === 'string' ? { code: e.code, retryable: e.retryable === true } : null;
}

export class ApiClient {
  constructor(
    private readonly basePath: string,
    private readonly store: TokenStore,
    private readonly reauthorize: () => Promise<string>,
    // Wrapped, not stored: a browser's fetch refuses to run with `this` bound to us.
    private readonly fetchImpl: Fetch = (input, init) => fetch(input, init),
  ) {}

  // One re-mint on a 401, then the failed request once more. A second 401
  // is the session being over, not a reason to try a third time.
  async request<T>(method: string, path: string, body?: unknown): Promise<Reply<T>> {
    let reply = await this.send(method, path, body);
    if (reply.status === 401) {
      this.store.set(await this.reauthorize());
      reply = await this.send(method, path, body);
      if (reply.status === 401) throw new SessionExpired();
    }
    if (reply.status >= 400) {
      const parsed = envelope(reply.json);
      throw new ApiError(reply.status, parsed?.code ?? 'UNKNOWN', parsed?.retryable ?? false);
    }
    return { status: reply.status, body: reply.json as T | null };
  }

  private async send(method: string, path: string, body?: unknown) {
    const headers: Record<string, string> = { Accept: 'application/json' };
    const token = this.store.get();
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await this.fetchImpl(`${this.basePath}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json: unknown = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }
    return { status: res.status, json };
  }
}
