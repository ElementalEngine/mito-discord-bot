import { useEffect, useState } from 'react';

import { firstEmptySeat, type LobbyDoc, seatOf } from '../model.js';
import type { ApiClient } from '../transport/client.js';
import { subscribe } from '../transport/poll.js';
import { BansScreen } from './bans.js';
import { CompleteScreen } from './complete.js';
import { DraftScreen } from './draft.js';
import { SettingsScreen } from './settings.js';
import type { Me } from '../whoami.js';

type Props = { api: ApiClient; me: Me; lobbyId: string; onBack: () => void };

export function LobbyScreen({ api, me, lobbyId, onBack }: Props) {
  const [lobby, setLobby] = useState<LobbyDoc | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const sub = subscribe(
      api,
      lobbyId,
      (doc) => setLobby(doc as LobbyDoc),
      (e) => setError(e instanceof Error ? e.message : String(e)),
    );
    return () => sub.stop();
  }, [api, lobbyId]);

  // Every mutation returns the updated document, so render it at once
  // rather than waiting for the next poll tick.
  const act = (method: string, path: string, body: unknown) =>
    api
      .request<LobbyDoc>(method, `/lobbies/${lobbyId}${path}`, body)
      .then((reply) => reply.body && setLobby(reply.body))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));

  if (error) return <p>{error} <button onClick={onBack}>Back</button></p>;
  if (!lobby) return <p>Loading lobby…</p>;

  const mine = seatOf(lobby, me.uid);
  const isHost = lobby.host_discord_id === me.uid;
  const empty = firstEmptySeat(lobby);
  const rev = { expected_revision: lobby.revision };

  if (lobby.phase === 'settings') {
    return <SettingsScreen lobby={lobby} mine={mine} act={act} />;
  }
  if (lobby.phase === 'bans') {
    return <BansScreen api={api} lobby={lobby} mine={mine} act={act} />;
  }
  if (lobby.phase === 'draft') {
    return <DraftScreen lobby={lobby} mine={mine} act={act} />;
  }
  if (lobby.phase === 'complete' || lobby.phase === 'cancelled') {
    return <><CompleteScreen lobby={lobby} /><button onClick={onBack}>Back</button></>;
  }
  if (lobby.phase !== 'lobby') {
    return <p>Phase: {lobby.phase} — screen not built yet. <button onClick={onBack}>Back</button></p>;
  }

  return (
    <section>
      <h2>
        LOBBY OPEN — {lobby.edition.toUpperCase()} {lobby.game_type}
      </h2>
      {lobby.host_rules && <p>{lobby.host_rules}</p>}
      <ol start={1} style={{ columns: 2 }}>
        {Array.from({ length: lobby.seat_count }, (_, i) => {
          const seat = lobby.seats.find((s) => s.seat_index === i);
          const label = seat ? seat.discord_id : '[empty]';
          return (
            <li key={i} style={{ fontWeight: seat?.discord_id === me.uid ? 'bold' : 'normal' }}>
              {label}
              {seat && lobby.host_discord_id === seat.discord_id ? ' (host)' : ''}
            </li>
          );
        })}
      </ol>
      <p>
        {lobby.seats.length}/{lobby.seat_count} seated · needs {lobby.min_seats} · rev {lobby.revision}
      </p>
      {!mine && empty !== null && (
        <button onClick={() => act('PATCH', '/seats', { ...rev, action: 'place', seat_index: empty })}>Join</button>
      )}{' '}
      {mine && !isHost && <button onClick={() => act('PATCH', '/seats', { ...rev, action: 'leave' })}>Leave</button>}{' '}
      {isHost && (
        <button disabled={lobby.seats.length < lobby.min_seats} onClick={() => act('POST', '/start', rev)}>
          Start
        </button>
      )}{' '}
      <button onClick={onBack}>Back</button>
    </section>
  );
}
