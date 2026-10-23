// Runs for one key go one at a time, each after the one before it settles;
// other keys are not held up.
export function serial(): <T>(key: string, run: () => Promise<T>) => Promise<T> {
  const tails = new Map<string, Promise<unknown>>();
  return (key, run) => {
    const next = (tails.get(key) ?? Promise.resolve()).then(run, run);
    tails.set(key, next);
    const settle = (): void => {
      if (tails.get(key) === next) tails.delete(key);
    };
    next.then(settle, settle);
    return next;
  };
}
