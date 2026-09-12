import type { Upstream } from './proxy.js';
import { log } from './log.js';

export const EDITIONS = ['civ6', 'civ7'] as const;
export type Edition = (typeof EDITIONS)[number];
export const isEdition = (value: string): value is Edition =>
  (EDITIONS as readonly string[]).includes(value);

type Entry = { body: Buffer; fetchedAt: number };
export type Served = { status: number; body: Buffer | null };

// Two editions, refreshed lazily. A lapsed entry is refreshed on the next
// read, and kept if the refresh fails: stale leader data beats none.
export class CivDataCache {
  private readonly entries = new Map<Edition, Entry>();

  constructor(
    private readonly upstream: Upstream,
    private readonly ttlMs = 10 * 60_000,
  ) {}

  async get(edition: Edition, now = Date.now()): Promise<Served> {
    const cached = this.entries.get(edition);
    if (cached && now - cached.fetchedAt < this.ttlMs) {
      return { status: 200, body: cached.body };
    }
    const fresh = await this.fetch(edition);
    if (fresh) {
      this.entries.set(edition, { body: fresh, fetchedAt: now });
      return { status: 200, body: fresh };
    }
    if (cached) {
      log.warn(`civ-data ${edition}: refresh failed, serving stale`);
      return { status: 200, body: cached.body };
    }
    return { status: 503, body: null };
  }

  private async fetch(edition: Edition): Promise<Buffer | null> {
    try {
      const reply = await fetch(`${this.upstream.baseUrl}/api/v2/civ-data/${edition}`, {
        headers: { Authorization: `Bearer ${this.upstream.bearer}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(5_000),
      });
      if (!reply.ok) {
        log.warn(`civ-data ${edition}: upstream ${reply.status}`);
        return null;
      }
      return Buffer.from(await reply.arrayBuffer());
    } catch (error) {
      log.warn(`civ-data ${edition}: unreachable`, error instanceof Error ? error.message : error);
      return null;
    }
  }
}
