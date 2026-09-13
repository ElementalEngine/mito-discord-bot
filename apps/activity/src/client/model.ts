import type { Lobby } from './transport/poll.js';

// Seats are sparse: only occupied ones are stored.
export type Seat = { seat_index: number; discord_id: string; team: number | null; ready?: boolean; pick?: unknown; ballot?: Record<string, string>; bans?: { leader_keys: string[]; civ_keys: string[] }; pool?: string[] };

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
};

export const seatOf = (lobby: LobbyDoc, uid: string): Seat | undefined =>
  lobby.seats.find((seat) => seat.discord_id === uid);

export const firstEmptySeat = (lobby: LobbyDoc): number | null => {
  const taken = new Set(lobby.seats.map((seat) => seat.seat_index));
  for (let i = 0; i < lobby.seat_count; i += 1) if (!taken.has(i)) return i;
  return null;
};
