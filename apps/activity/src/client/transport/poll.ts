import type { ApiClient, Reply } from './client.js';

export type Phase = 'lobby' | 'settings' | 'bans' | 'draft' | 'complete' | 'cancelled';
export const TERMINAL: ReadonlySet<string> = new Set<Phase>(['complete', 'cancelled']);

export type Lobby = { _id: string; revision: number; phase: Phase } & Record<string, unknown>;

export type Subscription = { stop(): void; done: Promise<void> };

// Polls one lobby until it closes. 204 means nothing moved; a document
// replaces the last one whole, whatever phase it arrived in.
export function subscribe(
  api: ApiClient,
  lobbyId: string,
  onState: (lobby: Lobby) => void,
  onError: (error: unknown) => void,
  intervalMs = 2_000,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Subscription {
  let running = true;
  let revision: number | null = null;

  const done = (async () => {
    while (running) {
      try {
        const query: string = revision === null ? '' : `?since=${revision}`;
        const reply: Reply<Lobby> = await api.request<Lobby>('GET', `/lobbies/${lobbyId}${query}`);
        if (reply.status === 200 && reply.body) {
          revision = reply.body.revision;
          onState(reply.body);
          if (TERMINAL.has(reply.body.phase)) running = false;
        }
      } catch (error) {
        onError(error);
        running = false;
      }
      if (running) await sleep(intervalMs);
    }
  })();

  return { stop: () => void (running = false), done };
}
