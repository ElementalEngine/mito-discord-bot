import type { HttpClient } from "./http.js";

/**
 * R1 stub — activity-session & season telemetry (architecture §6).
 * Routes land after R4 (core-api sessions/seasons endpoints).
 * Record shape below is a DRAFT — NON-FINAL per ruling O2; the core-api chat
 * owns the contract. Do not consume outside feature-flagged code paths.
 */
export type DraftTelemetryRecord = {
  session_id: string;
  season_id?: string;
  guild_id: string;
  game: "civ6" | "civ7";
  source: "activity" | "command";
  mode: string;
  draft_type: string;
  map_type?: string;
  settings: Record<string, unknown>;
  bans: readonly unknown[];
  picks: readonly unknown[];
  participants: readonly unknown[];
  vote_summary?: Record<string, unknown>;
  started_at: string;
  completed_at?: string;
  match_id?: string;
};

export class SessionsApi {
  readonly http: HttpClient;

  constructor(http: HttpClient) {
    this.http = http;
  }
}
