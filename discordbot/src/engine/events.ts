import type { CivEdition } from '../shared/civ.types.js';
import type { EnginePick, EngineSeatPools } from './types.js';

export type EventVisibility = 'public' | Readonly<{ seatId: string }>;

type Ev<T extends string, P> = Readonly<{ type: T; visibility: EventVisibility } & P>;

export type DraftEngineEvent =
  | Ev<'SESSION_STARTED', { kind: 'blind' | 'snake' | 'cwc'; edition: CivEdition; seatIds: readonly string[] }>
  | Ev<'POOLS_DEALT', { seatId: string; pools: EngineSeatPools }>
  | Ev<'ORDER_SET', { order: readonly string[]; note: string }>
  | Ev<'DEADLINE_SET', { durationMs: number; deadlineKind: 'session' | 'turn' | 'captains' }>
  | Ev<'TURN_STARTED', { seatId: string; round: 'leader' | 'civ'; turnToken: number; durationMs: number; teamIndex?: 0 | 1 }>
  | Ev<'STAGE_UPDATED', { seatId: string; staged: EnginePick }>
  | Ev<'PROGRESS_CHANGED', { stagedSeatIds: readonly string[]; committedSeatIds: readonly string[] }>
  | Ev<'PICK_COMMITTED', { seatId: string; round?: 'leader' | 'civ'; key?: string; auto: boolean; teamIndex?: 0 | 1 }>
  | Ev<'AUTO_PICK_APPLIED', { seatId: string; round: 'leader' | 'civ'; key: string; teamIndex?: 0 | 1 }>
  | Ev<'CAPTAIN_SET', { teamIndex: 0 | 1; userId: string; auto: boolean }>
  | Ev<'ROUND_ADVANCED', { round: 'leader' | 'civ' }>
  | Ev<'PICKS_REVEALED', { picks: Readonly<Record<string, EnginePick>>; reason: 'complete' | 'timeout' }>
  | Ev<'SESSION_CLOSED_NO_POOL', { message: string }>
  | Ev<'DRAFT_COMPLETED', { reason: 'complete' | 'timeout' | 'no-pool' }>
  | Ev<'DRAFT_CANCELLED', { reason: string }>;

export function publicEvent<T extends DraftEngineEvent['type'], P extends Omit<Extract<DraftEngineEvent, { type: T }>, 'type' | 'visibility'>>(
  type: T,
  payload: P,
): Extract<DraftEngineEvent, { type: T }> {
  return { type, visibility: 'public', ...payload } as unknown as Extract<DraftEngineEvent, { type: T }>;
}

export function seatEvent<T extends DraftEngineEvent['type'], P extends Omit<Extract<DraftEngineEvent, { type: T }>, 'type' | 'visibility'>>(
  type: T,
  seatId: string,
  payload: P,
): Extract<DraftEngineEvent, { type: T }> {
  return { type, visibility: { seatId }, ...payload } as unknown as Extract<DraftEngineEvent, { type: T }>;
}

/** Censoring filter: the events a given seat may see. Transport (R6) must use this, not ad-hoc checks. */
export function eventsVisibleToSeat(
  events: readonly DraftEngineEvent[],
  seatId: string,
): DraftEngineEvent[] {
  return events.filter((event) => event.visibility === 'public' || event.visibility.seatId === seatId);
}
