import { useEffect, useState } from 'react';

import { type LobbyDoc, nameOf } from '../model.js';
import type { ApiClient } from '../transport/client.js';

type Props = { api: ApiClient; onOpen: (lobbyId: string) => void };

// The launcher path: every open lobby in the guild, with the voice channel
// a player has to be in to take a seat.
export function Dashboard({ api, onOpen }: Props) {
  const [lobbies, setLobbies] = useState<LobbyDoc[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .request<LobbyDoc[]>('GET', '/lobbies')
      .then((reply) => setLobbies(reply.body ?? []))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [api]);

  if (error) return <p>Could not load lobbies: {error}</p>;
  if (lobbies === null) return <p>Loading lobbies…</p>;
  if (lobbies.length === 0) return <p>No open lobbies.</p>;

  return (
    <ul style={{ listStyle: 'none', padding: 0 }}>
      {lobbies.map((lobby) => (
        <li key={lobby._id} style={{ border: '1px solid #888', padding: 8, marginBottom: 8 }}>
          <strong>
            {lobby.edition.toUpperCase()} {lobby.game_type}
          </strong>{' '}
          — {lobby.seats.length}/{lobby.seat_count} seated · host {nameOf(lobby.seats.find((s) => s.discord_id === lobby.host_discord_id))} · phase {lobby.phase}
          <br />
          <small>voice channel: {lobby.voice_channel_id}</small>
          {lobby.host_rules && (
            <>
              <br />
              <small>{lobby.host_rules}</small>
            </>
          )}
          <br />
          <button onClick={() => onOpen(lobby._id)}>Open</button>
        </li>
      ))}
    </ul>
  );
}
