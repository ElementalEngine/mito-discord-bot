import { inspect } from 'node:util';

type Level = 'debug' | 'info' | 'warn' | 'error';

const RANK: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

// journald adds its own timestamp, so the line carries only level and text.
const threshold = RANK[(process.env.LOG_LEVEL as Level | undefined) ?? 'info'] ?? RANK.info;

function render(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.stack ?? value.message;
  return inspect(value, { depth: 4, breakLength: Infinity });
}

function emit(level: Level, args: unknown[]): void {
  if (RANK[level] < threshold) return;
  const stream = level === 'warn' || level === 'error' ? process.stderr : process.stdout;
  stream.write(`${level.toUpperCase().padEnd(5)} ${args.map(render).join(' ')}\n`);
}

// Accepts what console accepts, so a call site migrates by changing one word.
export const log = {
  debug: (...args: unknown[]): void => emit('debug', args),
  info: (...args: unknown[]): void => emit('info', args),
  warn: (...args: unknown[]): void => emit('warn', args),
  error: (...args: unknown[]): void => emit('error', args),
} as const;
