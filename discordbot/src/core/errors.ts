import { ApiError } from './api/errors.js';

function safeStringify(value: unknown): string {
  try {
    return typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.body !== undefined ? `: ${safeStringify(err.body)}` : '';
    return `${err.message}${body}`;
  }

  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;

  if (err && typeof err === 'object' && 'message' in err) {
    const msg = (err as { message?: unknown }).message;
    if (typeof msg === 'string' && msg.trim()) return msg;
  }

  return 'Unknown error';
}