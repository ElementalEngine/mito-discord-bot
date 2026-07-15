import type { DraftTelemetryRecord } from '../core/api/sessions.api.js';
import { keysToColonTokens } from '../engine/index.js';
import { CIV6_LEADERS } from '../data/civ6.data.js';
import { CIV7_CIVS, CIV7_LEADERS } from '../data/civ7.data.js';
import type { RoomRecord } from './domain.js';

/** `{ KEY: { gameId } }` lookup shape shared by every frozen data map (verified). */
type GameIdSource = Readonly<Record<string, { readonly gameId: string }>>;

function gameOf(edition: RoomRecord['config']['edition']): 'civ6' | 'civ7' {
  return edition === 'CIV6' ? 'civ6' : 'civ7';
}

function isoOrNull(ms: number | null): string | undefined {
  return ms === null ? undefined : new Date(ms).toISOString();
}

// ── Pick extraction (mode-dependent — see file header) ──────────────────────

type LeaderCivKeys = { leaderKeys: string[]; civKeys: string[] };

/** Final drafted keys, flattened across the whole session (for the reporting token). */
function collectFinalKeys(room: RoomRecord): LeaderCivKeys {
  const leaderKeys: string[] = [];
  const civKeys: string[] = [];
  const { draft } = room;

  if (draft.kind === 'instant') {
    for (const group of draft.result.groups) {
      leaderKeys.push(...group.leaders);
      if (group.civs) civKeys.push(...group.civs);
    }
  } else if (draft.kind === 'interactive') {
    const state = draft.state;
    if (state.kind === 'cwc') {
      for (const team of state.teamPicks) {
        leaderKeys.push(...team.leaders);
        civKeys.push(...team.civs);
      }
    } else {
      // blind | snake: per-seat picks
      for (const pick of Object.values(state.picks)) {
        if (pick.leaderKey) leaderKeys.push(pick.leaderKey);
        if (pick.civKey) civKeys.push(pick.civKey);
      }
    }
  }
  return { leaderKeys, civKeys };
}

/** Structured, per-group/seat/team picks for the telemetry record. */
function buildPicks(room: RoomRecord): readonly unknown[] {
  const { draft } = room;
  if (draft.kind === 'instant') {
    return draft.result.groups.map((group, index) => ({
      group: index,
      leader_ids: group.leaders,
      civ_ids: group.civs ?? [],
    }));
  }
  if (draft.kind === 'interactive') {
    const state = draft.state;
    if (state.kind === 'cwc') {
      return state.teamPicks.map((team, index) => ({
        team: index,
        leader_ids: team.leaders,
        civ_ids: team.civs,
      }));
    }
    const order = seatOrder(room);
    return order.map((seatId) => ({
      user_id: seatId,
      leader_id: state.picks[seatId]?.leaderKey ?? null,
      civ_id: state.picks[seatId]?.civKey ?? null,
      order: order.indexOf(seatId),
    }));
  }
  return [];
}

function seatOrder(room: RoomRecord): string[] {
  return Object.values(room.members)
    .sort((a, b) => a.seatIndex - b.seatIndex)
    .map((m) => m.userId);
}

// ── Public builders ─────────────────────────────────────────────────────────

/**
 * Assemble the §B.1 draft telemetry record from a completed room.
 * Typechecks as `DraftTelemetryRecord` by construction (single source of truth).
 */
export function buildDraftRecord(room: RoomRecord): DraftTelemetryRecord {
  const locked = room.settings.locked ?? {};
  const participants = seatOrder(room).map((seatId) => {
    const member = room.members[seatId];
    return { user_id: seatId, seat_index: member.seatIndex, team: member.team ?? null };
  });

  const voteSummary: Record<string, unknown> = {};
  for (const [questionId, winnerId] of Object.entries(locked)) {
    const tiebreak = room.settings.tiebreaks.find((t) => t.questionId === questionId) ?? null;
    voteSummary[questionId] = { winner: winnerId, tiebreak };
  }

  const bans: readonly unknown[] = [
    {
      by: 'majority',
      leader_ids: room.bans.resolvedLeaderKeys ?? [],
      civ_ids: room.bans.resolvedCivKeys ?? [],
    },
  ];

  return {
    session_id: room.id,
    guild_id: room.config.guildId,
    game: gameOf(room.config.edition),
    source: room.config.source,
    mode: room.config.mode,
    draft_type: room.draftType ?? 'standard',
    ...(locked['map'] ? { map_type: locked['map'] } : {}),
    settings: locked,
    bans,
    picks: buildPicks(room),
    participants,
    vote_summary: voteSummary,
    started_at: new Date(room.startedAt ?? room.createdAt).toISOString(),
    ...(isoOrNull(room.completedAt) ? { completed_at: isoOrNull(room.completedAt) } : {}),
  };
}

export function buildReportingToken(room: RoomRecord): string | null {
  const { leaderKeys, civKeys } = collectFinalKeys(room);
  const leaderSource: GameIdSource = room.config.edition === 'CIV6' ? CIV6_LEADERS : CIV7_LEADERS;

  const parts: string[] = [];
  const leaderToken = keysToColonTokens(leaderKeys, leaderSource);
  if (leaderToken) parts.push(leaderToken);
  if (room.config.edition === 'CIV7') {
    const civToken = keysToColonTokens(civKeys, CIV7_CIVS);
    if (civToken) parts.push(civToken);
  }

  return parts.length ? parts.join('\n') : null;
}
