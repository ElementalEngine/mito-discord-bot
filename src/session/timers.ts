export interface Clock {
  now(): number;
  /** Run `fire` at absolute time `atMs`; return an opaque handle for cancellation. */
  schedule(atMs: number, fire: () => void): unknown;
  cancel(handle: unknown): void;
}

export interface Deadline {
  token: string;
  at: number;
}

export interface DeadlineRegistry {
  /** Arm (or supersede) the single deadline: fire `onFire(token)` at absolute time `at`. */
  arm(token: string, at: number): void;
  /** Cancel the pending deadline, if any. */
  disarm(): void;
  /** Reconstruct a persisted deadline on restart (null clears). */
  rehydrate(deadline: Deadline | null): void;
  /** The token of the pending deadline, or null. */
  activeToken(): string | null;
}

export function createDeadlineRegistry(params: { clock: Clock; onFire: (token: string) => void }): DeadlineRegistry {
  const { clock, onFire } = params;
  let active: { token: string; handle: unknown; generation: number } | null = null;
  let generation = 0;

  function disarm(): void {
    if (active) {
      clock.cancel(active.handle);
      active = null;
    }
  }

  function arm(token: string, at: number): void {
    disarm();
    const myGeneration = (generation += 1);
    const handle = clock.schedule(at, () => {
      // Only act if this callback is still the active generation (guards a leaked/elapsed timer).
      if (active && active.generation === myGeneration) {
        active = null;
        onFire(token);
      }
    });
    active = { token, handle, generation: myGeneration };
  }

  function rehydrate(deadline: Deadline | null): void {
    disarm();
    if (deadline) arm(deadline.token, deadline.at);
  }

  function activeToken(): string | null {
    return active ? active.token : null;
  }

  return { arm, disarm, rehydrate, activeToken };
}


export function createSystemClock(): Clock {
  return {
    now: () => Date.now(),
    schedule: (atMs, fire) => setTimeout(fire, Math.max(0, atMs - Date.now())),
    cancel: (handle) => {
      clearTimeout(handle as Parameters<typeof clearTimeout>[0]);
    },
  };
}
