import type { Lobby } from './transport/poll.js';

// Seats are sparse: only occupied ones are stored.
export type Seat = { seat_index: number; discord_id: string; team: number | null; ready?: boolean; pick?: unknown; civ_pick?: unknown; ballot?: Record<string, string>; bans?: { leader_keys: string[]; civ_keys: string[] }; pool?: string[]; civ_pool?: string[]; name?: string };

// A cwc team's picks, in turn order: leaders[i] and civs[i] came together.
export type Team = { team_index: number; leaders: string[]; civs: string[] };

export type LobbyDoc = Lobby & {
  host_discord_id: string;
  edition: 'civ6' | 'civ7';
  game_type: string;
  seat_count: number;
  min_seats: number;
  seats: Seat[];
  voice_channel_id: string;
  host_rules?: string;
  number_teams?: number | null;
  team_size?: number | null;
  // When the current phase or turn runs out. The server enforces it; the
  // client only shows it.
  turn_expires_at?: string | null;
  settings?: Record<string, string>;
  // cwc only: one shared pool, captains pick in turn, picks land on teams.
  pool?: string[];
  civ_pool?: string[];
  pick_order?: string[];
  turn_index?: number;
  teams?: Team[];
};

export const nameOf = (seat: { discord_id: string; name?: string } | undefined): string =>
  seat ? (seat.name ?? seat.discord_id) : '[empty]';

export const seatOf = (lobby: LobbyDoc, uid: string): Seat | undefined =>
  lobby.seats.find((seat) => seat.discord_id === uid);

export const firstEmptySeat = (lobby: LobbyDoc): number | null => {
  const taken = new Set(lobby.seats.map((seat) => seat.seat_index));
  for (let i = 0; i < lobby.seat_count; i += 1) if (!taken.has(i)) return i;
  return null;
};

// Who has finished the current phase, for the list under each screen.
export const statusOf = (lobby: LobbyDoc, done: string, pending: string) =>
  [...lobby.seats]
    .sort((a, b) => a.seat_index - b.seat_index)
    .map((s) => ({ key: s.seat_index, name: nameOf(s), done: s.ready === true, state: s.ready ? done : pending }));

// `name` is the emoji's id name; `display` is what a player reads.
export type CivRow = { token: string; name: string; display?: string | null; civ?: string | null; civ_display?: string | null; emoji_id?: string | null };
export type CivData = { leaders: CivRow[]; civs: CivRow[] };

// The last resort when a token has no row: LEADER_T_ROOSEVELT -> T Roosevelt.
export const pretty = (token: string) =>
  token.replace(/^(LEADER|CIVILIZATION)_/, '').toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export const rowsOf = (civData: CivData): Map<string, CivRow> =>
  new Map([...civData.leaders, ...civData.civs].map((row) => [row.token, row]));

export const displayOf = (rows: Map<string, CivRow>, token: string): string =>
  rows.get(token)?.display ?? pretty(token);

// civ6 only: the leader's civ, named. civ7 leaders carry none.
export const civOf = (rows: Map<string, CivRow>, token: string): string | undefined => {
  const row = rows.get(token);
  if (row?.civ_display) return row.civ_display;
  return row?.civ ? pretty(row.civ) : undefined;
};
