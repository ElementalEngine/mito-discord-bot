// How a private panel closes itself, and the last moment it still can: an
// interaction token lasts 15 minutes.
export type Closer = Readonly<{ close: () => Promise<unknown>; until: number }>;

export type IdleCloser = Readonly<{
  open: (key: string, id: string, closer: Closer, ms: number) => void;
  touch: (key: string, id: string, ms: number, closer?: Closer) => boolean;
}>;

// One open panel per key, named by its message id. It closes once idle for
// its time, or sooner if its token would run out first.
export function idleCloser(now: () => number = Date.now): IdleCloser {
  const held = new Map<string, { id: string; closer: Closer; timer: NodeJS.Timeout }>();
  const close = (key: string): void => {
    const open = held.get(key);
    if (!open) return;
    clearTimeout(open.timer);
    held.delete(key);
    void open.closer.close().catch(() => undefined);
  };
  const arm = (key: string, id: string, closer: Closer, ms: number): void => {
    const timer = setTimeout(() => close(key), Math.max(0, Math.min(ms, closer.until - now())));
    timer.unref();
    held.set(key, { id, closer, timer });
  };
  return {
    // A new panel for the key closes the one before it at once.
    open(key, id, closer, ms) {
      close(key);
      arm(key, id, closer, ms);
    },
    // Activity on the open panel restarts its clock, with a fresher closer
    // when given; false when this panel is not the open one.
    touch(key, id, ms, closer) {
      const open = held.get(key);
      if (open?.id !== id) return false;
      clearTimeout(open.timer);
      arm(key, id, closer ?? open.closer, ms);
      return true;
    },
  };
}
