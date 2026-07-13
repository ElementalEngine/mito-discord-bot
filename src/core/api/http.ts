import { config } from "../config/index.js";
import { ApiError } from "./errors.js";

export type FetchLike = typeof fetch;

/**
 * Shared HTTP transport for all core-api domain clients (architecture §2).
 * Behavior is byte-equivalent to the legacy ApiClient transport: 30s timeout,
 * Bearer BACKEND_SERVICE_TOKEN injection (frozen contract), 5xx/network retry.
 */
export class HttpClient {
  readonly base: string;
  private readonly fetcher: FetchLike;
  private readonly serviceToken: string;

  constructor(base = config.backend.url, fetcher: FetchLike = fetch, serviceToken = config.backend.serviceToken) {
    this.base = base.replace(/\/+$/, "");
    this.fetcher = fetcher;
    this.serviceToken = serviceToken;
  }

  async fetchWithRetry(input: RequestInfo | URL, init?: RequestInit, attempts = 1): Promise<Response> {
    let lastErr: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30_000);
        try {
          const headers = new Headers(init?.headers);
          if (this.serviceToken) headers.set("authorization", `Bearer ${this.serviceToken}`);
          const res = await this.fetcher(input, { ...init, headers, signal: controller.signal });
          if (!res.ok) {
            const body = await this.safeJson(res);
            throw new ApiError(`HTTP ${res.status}`, res.status, body);
          }
          return res;
        } finally {
          clearTimeout(timeout);
        }
      } catch (err) {
        lastErr = err;
        const status = err instanceof ApiError ? err.status : 0;
        const retriable = status === 0 || (status >= 500 && status <= 599);
        if (!retriable || i === attempts - 1) throw err;
        await new Promise(r => setTimeout(r, Math.min(2000, 200 * Math.pow(2, i))));
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error("Unknown API error");
  }

  async parseJson(res: Response): Promise<unknown> {
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new ApiError("Invalid JSON from backend", res.status, text);
    }
  }

  private async safeJson(res: Response): Promise<unknown | string> {
    const text = await res.text().catch(() => "");
    try {
      return text ? JSON.parse(text) : "";
    } catch {
      return text;
    }
  }
}
