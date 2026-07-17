import type { SessionCommand } from '../session/index.js';

// ── Server → client frames ───────────────────────────────────────────────────

export type ServerMessage =
  | { type: 'snapshot'; snapshot: unknown } // projectRoom result for this recipient
  | { type: 'update'; snapshot: unknown; events: readonly unknown[] } // per-recipient fan-out
  | { type: 'notify'; message: string }
  | { type: 'ack'; ok: true }
  | { type: 'reject'; code: string; message: string }
  | { type: 'closed'; reason: string };

// ── Client → server parse result ─────────────────────────────────────────────

export type ParseFailure = 'not-json' | 'not-object' | 'unknown-type' | 'bad-args';

export type ParseResult =
  | { ok: true; command: SessionCommand }
  | { ok: false; reason: ParseFailure };

/** Parse a raw ws text frame into a SessionCommand bound to `callerId`. */
export function parseClientMessage(raw: string, callerId: string): ParseResult {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return fail('not-json');
  }
  if (!isRecord(value)) return fail('not-object');
  return toSessionCommand(value, callerId);
}

/** Map an already-parsed object to a SessionCommand (exposed for unit tests). */
export function toSessionCommand(msg: Record<string, unknown>, callerId: string): ParseResult {
  const type = msg.type;
  const ev = optionalVersion(msg.expectedVersion);

  switch (type) {
    case 'JOIN': {
      const team = optionalNumber(msg.team);
      return ok({ type: 'JOIN', userId: callerId, ...(team !== undefined ? { team } : {}), ...ev });
    }
    case 'LEAVE':
      return ok({ type: 'LEAVE', userId: callerId, ...ev });
    case 'SET_READY': {
      if (typeof msg.ready !== 'boolean') return fail('bad-args');
      return ok({ type: 'SET_READY', userId: callerId, ready: msg.ready, ...ev });
    }
    case 'CAST_VOTE': {
      if (!isNonEmptyString(msg.questionId)) return fail('bad-args');
      const optionIds = asStringArray(msg.optionIds);
      if (optionIds === null) return fail('bad-args');
      return ok({ type: 'CAST_VOTE', userId: callerId, questionId: msg.questionId, optionIds, ...ev });
    }
    case 'RANDOMIZE_BALLOT':
      return ok({ type: 'RANDOMIZE_BALLOT', userId: callerId, ...ev });
    case 'CAST_BAN': {
      const leaderKeys = asStringArray(msg.leaderKeys);
      const civKeys = asStringArray(msg.civKeys);
      if (leaderKeys === null || civKeys === null) return fail('bad-args');
      return ok({ type: 'CAST_BAN', userId: callerId, leaderKeys, civKeys, ...ev });
    }
    case 'ADVANCE':
      return ok({ type: 'ADVANCE', byUserId: callerId, ...ev });
    case 'STAGE_PICK': {
      if (msg.pickType !== 'leader' && msg.pickType !== 'civ') return fail('bad-args');
      if (!isNonEmptyString(msg.key)) return fail('bad-args');
      const turnToken = optionalNumber(msg.turnToken);
      return ok({
        type: 'STAGE_PICK',
        userId: callerId,
        pickType: msg.pickType,
        key: msg.key,
        ...(turnToken !== undefined ? { turnToken } : {}),
        ...ev,
      });
    }
    case 'SUBMIT_PICK': {
      const turnToken = optionalNumber(msg.turnToken);
      return ok({ type: 'SUBMIT_PICK', userId: callerId, ...(turnToken !== undefined ? { turnToken } : {}), ...ev });
    }
    case 'PICK': {
      if (!isNonEmptyString(msg.key)) return fail('bad-args');
      const turnToken = optionalNumber(msg.turnToken);
      if (turnToken === undefined) return fail('bad-args'); // PICK requires a turnToken
      return ok({ type: 'PICK', userId: callerId, key: msg.key, turnToken, ...ev });
    }
    case 'SELECT_CAPTAIN': {
      if (msg.teamIndex !== 0 && msg.teamIndex !== 1) return fail('bad-args');
      if (!isNonEmptyString(msg.userId)) return fail('bad-args'); // the chosen captain (a target)
      return ok({ type: 'SELECT_CAPTAIN', byUserId: callerId, teamIndex: msg.teamIndex, userId: msg.userId, ...ev });
    }
    case 'CANCEL': {
      const reason = isNonEmptyString(msg.reason) ? msg.reason : 'cancelled by user';
      return ok({ type: 'CANCEL', reason, byUserId: callerId, ...ev });
    }
    default:
      return fail('unknown-type');
  }
  // Note: TIMEOUT is intentionally NOT client-reachable — deadlines are actor-internal.
}

// ── Internals ────────────────────────────────────────────────────────────────

function ok(command: SessionCommand): ParseResult {
  return { ok: true, command };
}

function fail(reason: ParseFailure): ParseResult {
  return { ok: false, reason };
}

function optionalVersion(value: unknown): { expectedVersion: number } | Record<string, never> {
  const n = optionalNumber(value);
  return n !== undefined ? { expectedVersion: n } : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Return a string[] if every element is a string, else null. */
function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') return null;
    out.push(item);
  }
  return out;
}
