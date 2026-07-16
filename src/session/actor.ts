import { processSessionCommand } from './domain.js';
import type { CommandResponse, RoomRecord, SessionCommand, SessionDeps, SessionEffect } from './domain.js';
import { createDeadlineRegistry } from './timers.js';
import type { Clock } from './timers.js';

/** Executes forwarded effects (transport at R6, stub in tests). Errors are the executor's concern. */
export type EffectExecutor = (effects: readonly SessionEffect[], room: RoomRecord) => void | Promise<void>;

export interface SessionActor {
  readonly id: string;
  /** Apply one command through the serialized queue; resolves with the reducer's response. */
  enqueue(command: SessionCommand): Promise<CommandResponse>;
  /** The current record (read-only view; do not mutate). */
  snapshot(): RoomRecord;
  /** True once the session closed (or dispose() was called); further commands are rejected. */
  isDisposed(): boolean;
  /** Disarm the deadline and stop accepting commands. Idempotent. */
  dispose(): void;
}

export function createSessionActor(params: {
  id: string;
  initial: RoomRecord;
  deps: SessionDeps;
  clock: Clock;
  executeEffects: EffectExecutor;
  /** Called exactly once when the actor disposes (directory removal hook). */
  onDisposed?: (id: string) => void;
}): SessionActor {
  const { id, deps, clock, executeEffects, onDisposed } = params;
  let room = params.initial;
  let disposed = false;
  let tail: Promise<void> = Promise.resolve();

  const registry = createDeadlineRegistry({
    clock,
    onFire: (token) => {
      void enqueue({ type: 'TIMEOUT', token });
    },
  });
  // Adopt a deadline already present on the initial record (rehydration path, R5.4).
  registry.rehydrate(room.deadline);

  async function runOne(command: SessionCommand): Promise<CommandResponse> {
    if (disposed) return { ok: false, code: 'INACTIVE', message: 'session actor is disposed' };

    const { room: nextRoom, effects, response } = processSessionCommand(room, command, deps);
    room = nextRoom;

    const forwarded: SessionEffect[] = [];
    let closed = false;
    for (const effect of effects) {
      if (effect.type === 'SET_DEADLINE') registry.arm(effect.token, effect.at);
      else if (effect.type === 'CLEAR_DEADLINE') registry.disarm();
      else {
        forwarded.push(effect);
        if (effect.type === 'SESSION_CLOSED') closed = true;
      }
    }
    if (forwarded.length) await executeEffects(forwarded, room);
    if (closed) dispose();
    return response;
  }

  function enqueue(command: SessionCommand): Promise<CommandResponse> {
    if (disposed) return Promise.resolve({ ok: false, code: 'INACTIVE', message: 'session actor is disposed' });
    const run = tail.then(() => runOne(command));
    // Keep the chain alive past a rejected executor; the caller still sees the rejection via `run`.
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    registry.disarm();
    if (onDisposed) onDisposed(id);
  }

  return {
    id,
    enqueue,
    snapshot: () => room,
    isDisposed: () => disposed,
    dispose,
  };
}

/**
 * In-process directory of live actors (civup's self-healing session map). `create` supersedes and
 * disposes a stale actor under the same id; actors remove themselves on dispose/SESSION_CLOSED.
 */
export class SessionActorDirectory {
  private readonly actors = new Map<string, SessionActor>();

  create(params: Parameters<typeof createSessionActor>[0]): SessionActor {
    const stale = this.actors.get(params.id);
    if (stale) stale.dispose();
    const actor = createSessionActor({
      ...params,
      onDisposed: (id) => {
        this.actors.delete(id);
        if (params.onDisposed) params.onDisposed(id);
      },
    });
    this.actors.set(params.id, actor);
    return actor;
  }

  get(id: string): SessionActor | undefined {
    return this.actors.get(id);
  }

  size(): number {
    return this.actors.size;
  }

  /** Dispose every actor (shutdown). */
  disposeAll(): void {
    for (const actor of [...this.actors.values()]) actor.dispose();
  }
}
