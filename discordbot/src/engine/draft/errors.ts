export class DraftError extends Error {
  public readonly code: 'VALIDATION' | 'NO_POOL';

  public constructor(code: DraftError['code'], message: string) {
    super(message);
    this.name = 'DraftError';
    this.code = code;
  }
}

/** Non-throwing error shape returned by the reducer (civup pattern). */
export type DraftInputError = Readonly<{
  error: Readonly<{
    code: 'VALIDATION' | 'NO_POOL' | 'INACTIVE' | 'STALE' | 'NOT_YOUR_TURN' | 'UNAVAILABLE' | 'NOT_READY' | 'NOT_MEMBER' | 'NOT_HOST';
    message: string;
  }>;
}>;

export function isDraftInputError(value: unknown): value is DraftInputError {
  return typeof value === 'object' && value !== null && 'error' in value;
}

export function inputError(
  code: DraftInputError['error']['code'],
  message: string,
): DraftInputError {
  return { error: { code, message } };
}
