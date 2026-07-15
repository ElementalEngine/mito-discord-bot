import { eventsVisibleToSeat } from '../engine/index.js';
import type { DraftEngineEvent, DraftSessionState } from '../engine/index.js';
import type { RoomRecord, RoomConfig, SeatMember, DraftSubState, SessionPhase } from './domain.js';

export type Recipient = { kind: 'seat'; seatId: string } | { kind: 'observer'; userId?: string };

/** Config fields safe to expose to clients (internal tuning like timers is omitted). */
export type PublicConfig = Pick<
  RoomConfig,
  'edition' | 'source' | 'mode' | 'gameType' | 'numberTeams' | 'startingAge' | 'hostId' | 'voteConfig'
>;

export interface RoomSnapshot {
  id: string;
  version: number;
  phase: SessionPhase;
  viewer: Recipient;
  config: PublicConfig;
  members: readonly SeatMember[];
  settings: {
    locked: Record<string, string> | null;
    /** seat → only this seat's entries; observer → all seats. */
    ballots: Record<string, Record<string, string>>;
  };
  bans: {
    resolvedLeaderKeys: string[] | null;
    resolvedCivKeys: string[] | null;
    /** seat → only this seat's submission; observer → all seats. */
    submissions: Record<string, { leaderKeys: string[]; civKeys: string[] }>;
  };
  draft: DraftSubState;
  deadline: { token: string; at: number } | null;
}

export type ProjectionResult = RoomSnapshot | { error: 'OBSERVER_IS_SEATED' };

/** Project a room for one recipient (see file header for the K7 rules). */
export function projectRoom(room: RoomRecord, recipient: Recipient): ProjectionResult {
  if (recipient.kind === 'observer') {
    if (recipient.userId !== undefined && room.members[recipient.userId]) {
      return { error: 'OBSERVER_IS_SEATED' };
    }
    return buildSnapshot(room, recipient, null);
  }
  return buildSnapshot(room, recipient, recipient.seatId);
}

/** Censor an event stream for a recipient (seat → own+public; observer → all). */
export function projectEvents(events: readonly DraftEngineEvent[], recipient: Recipient): readonly DraftEngineEvent[] {
  return recipient.kind === 'seat' ? eventsVisibleToSeat(events, recipient.seatId) : events;
}

// ── Internals ─────────────────────────────────────────────────────────────

/** `seatId === null` → uncensored (observer); otherwise censor to that seat. */
function buildSnapshot(room: RoomRecord, viewer: Recipient, seatId: string | null): RoomSnapshot {
  const members = Object.values(room.members).sort((a, b) => a.seatIndex - b.seatIndex);
  return {
    id: room.id,
    version: room.version,
    phase: room.phase,
    viewer,
    config: publicConfig(room.config),
    members,
    settings: {
      locked: room.settings.locked,
      ballots: seatId === null ? room.settings.ballots : ownBuckets(room.settings.ballots, seatId),
    },
    bans: {
      resolvedLeaderKeys: room.bans.resolvedLeaderKeys,
      resolvedCivKeys: room.bans.resolvedCivKeys,
      submissions: seatId === null ? room.bans.submissions : ownEntry(room.bans.submissions, seatId),
    },
    draft: seatId === null ? room.draft : censorDraft(room.draft, seatId),
    deadline: room.deadline,
  };
}

function publicConfig(config: RoomConfig): PublicConfig {
  return {
    edition: config.edition,
    source: config.source,
    mode: config.mode,
    gameType: config.gameType,
    numberTeams: config.numberTeams,
    startingAge: config.startingAge,
    hostId: config.hostId,
    voteConfig: config.voteConfig,
  };
}

function censorDraft(draft: DraftSubState, seatId: string): DraftSubState {
  if (draft.kind === 'interactive') {
    return { kind: 'interactive', state: censorInteractiveForSeat(draft.state, seatId) };
  }
  return draft; // none | instant → public
}

/**
 * Blind: reveal only the seat's own pool + own staged; committed picks stay hidden until the draft
 * completes (PICKS_REVEALED). Snake: order/pools/picks are the public board; only `staged` is
 * private. CWC: no per-seat private data (picks are team-level; captains public).
 */
function censorInteractiveForSeat(state: DraftSessionState, seatId: string): DraftSessionState {
  if (state.kind === 'blind') {
    const revealed = state.status === 'complete';
    return {
      ...state,
      pools: pickOwn(state.pools, seatId),
      staged: pickOwn(state.staged, seatId),
      picks: revealed ? state.picks : pickOwn(state.picks, seatId),
    };
  }
  if (state.kind === 'snake') {
    return { ...state, staged: pickOwn(state.staged, seatId) };
  }
  return state; // cwc
}

function pickOwn<T>(record: Readonly<Record<string, T>>, seatId: string): Record<string, T> {
  return seatId in record ? { [seatId]: record[seatId] } : {};
}

function ownBuckets(ballots: Record<string, Record<string, string>>, seatId: string): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const [questionId, bucket] of Object.entries(ballots)) {
    if (seatId in bucket) out[questionId] = { [seatId]: bucket[seatId] };
  }
  return out;
}

function ownEntry<T>(record: Record<string, T>, seatId: string): Record<string, T> {
  return seatId in record ? { [seatId]: record[seatId] } : {};
}
