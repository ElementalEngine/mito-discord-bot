import { useEffect, useState } from 'react';

import { firstEmptySeat, type LobbyDoc, type Seat, seatOf } from '../model.js';
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
  const teams = lobby.number_teams ?? null;
  const seatAt = (i: number) => lobby.seats.find((s) => s.seat_index === i);
  const unassigned = lobby.seats.filter((s) => s.team === null || s.team === undefined);
  // Seat one of a team captains it, so the first name in a column is the one
  // who bans in CWC. Seating never implies a side; picking a team does.
  const label = (seat: Seat | undefined) =>
    seat ? `${seat.discord_id}${seat.discord_id === lobby.host_discord_id ? ' (host)' : ''}` : '[empty]';

  if (lobby.phase === 'settings') {
    return <SettingsScreen lobby={lobby} mine={mine} act={act} />;
  }
  if (lobby.phase === 'bans') {
    return <BansScreen api={api} lobby={lobby} me={me} mine={mine} act={act} />;
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
      {teams === null ? (
        <ol start={1} style={{ columns: 2 }}>
          {Array.from({ length: lobby.seat_count }, (_, i) => (
            <li key={i} style={{ fontWeight: seatAt(i)?.discord_id === me.uid ? 'bold' : 'normal' }}>
              {label(seatAt(i))}
            </li>
          ))}
        </ol>
      ) : (
        <div style={{ display: 'flex', gap: 24 }}>
          {Array.from({ length: teams }, (_, team) => (
            <div key={team}>
              <h3>Team {team + 1}</h3>
              <ol>
                {lobby.seats
                  .filter((s) => s.team === team)
                  .sort((a, b) => a.seat_index - b.seat_index)
                  .map((s, place) => (
                    <li key={s.seat_index} style={{ fontWeight: s.discord_id === me.uid ? 'bold' : 'normal' }}>
                      {label(s)}
                      {place === 0 ? ' — captain' : ''}
                    </li>
                  ))}
              </ol>
              {(!mine || mine.team !== team) && empty !== null && (
                <button onClick={() => act('PATCH', '/seats', { ...rev, action: 'place', seat_index: mine?.seat_index ?? empty, team })}>
                  {mine ? 'Switch here' : 'Join here'}
                </button>
              )}
            </div>
          ))}
          {unassigned.length > 0 && (
            <div>
              <h3>No team yet</h3>
              <ol>{unassigned.map((s) => <li key={s.seat_index}>{label(s)}</li>)}</ol>
            </div>
          )}
        </div>
      )}
      <p>
        {lobby.seats.length}/{lobby.seat_count} seated · needs {lobby.min_seats} · rev {lobby.revision}
      </p>
      {teams === null && !mine && empty !== null && (
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
