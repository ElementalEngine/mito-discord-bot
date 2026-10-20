import { type ReactNode, useEffect, useState } from 'react';

import { type CivData, firstEmptySeat, type LobbyDoc, nameOf, type Seat, seatOf } from '../model.js';
import type { ApiClient } from '../transport/client.js';
import { subscribe } from '../transport/poll.js';
import { BansScreen } from './bans.js';
import { CompleteScreen } from './complete.js';
import { DraftScreen } from './draft.js';
import { SettingsScreen } from './settings.js';
import type { Me } from '../whoami.js';
import { Button, Panel, Screen } from '../ui/index.js';

type Props = { api: ApiClient; me: Me; lobbyId: string; onBack: () => void };
type Act = (method: string, path: string, body: unknown) => Promise<unknown>;

const NO_CIV_DATA: CivData = { leaders: [], civs: [] };

export function LobbyScreen({ api, me, lobbyId, onBack }: Props) {
  const [lobby, setLobby] = useState<LobbyDoc | null>(null);
  // A failed poll ends the subscription, so it replaces the screen. A refused
  // action does not: the lobby is still live, so it is said and dismissed.
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const sub = subscribe(
      api,
      lobbyId,
      (doc) => setLobby(doc as LobbyDoc),
      (e) => setError(e instanceof Error ? e.message : String(e)),
    );
    return () => sub.stop();
  }, [api, lobbyId]);

  const [civData, setCivData] = useState<CivData | null>(null);
  const edition = lobby?.edition;

  useEffect(() => {
    if (!edition) return;
    api
      .request<CivData>('GET', `/civ-data/${edition}`)
      .then((r) => setCivData(r.body ?? NO_CIV_DATA))
      .catch(() => setCivData(NO_CIV_DATA));
  }, [api, edition]);

  // Every mutation returns the updated document, so render it at once
  // rather than waiting for the next poll tick.
  const act: Act = (method, path, body) => {
    setNotice(null);
    return api
      .request<LobbyDoc>(method, `/lobbies/${lobbyId}${path}`, body)
      .then((reply) => reply.body && setLobby(reply.body))
      .catch((e: unknown) => setNotice(e instanceof Error ? e.message : String(e)));
  };

  if (error) return <Screen title="Lobby"><Panel className="text-sm text-danger">{error}</Panel><Button onClick={onBack}>Back</Button></Screen>;
  if (!lobby) return <Screen title="Lobby"><p className="text-sm text-muted">Loading{'\u2026'}</p></Screen>;

  const mine = seatOf(lobby, me.uid);
  const banner = notice && (
    <div className="mx-auto w-full max-w-3xl px-3 pt-3 sm:px-4">
      <Panel className="flex items-start justify-between gap-3 border-danger/40 py-2 text-sm text-danger">
        <span>{notice}</span>
        <button type="button" className="text-xs text-muted hover:text-ink" onClick={() => setNotice(null)}>Dismiss</button>
      </Panel>
    </div>
  );

  let body: ReactNode;
  if (lobby.phase === 'settings') {
    body = <SettingsScreen lobby={lobby} mine={mine} act={act} />;
  } else if (lobby.phase === 'bans') {
    body = civData
      ? <BansScreen civData={civData} lobby={lobby} me={me} mine={mine} act={act} />
      : <Screen title="Bans"><p className="text-sm text-muted">Loading civ data{'\u2026'}</p></Screen>;
  } else if (lobby.phase === 'draft') {
    body = <DraftScreen civData={civData ?? NO_CIV_DATA} lobby={lobby} mine={mine} act={act} />;
  } else if (lobby.phase === 'complete' || lobby.phase === 'cancelled') {
    body = <><CompleteScreen civData={civData ?? NO_CIV_DATA} lobby={lobby} /><div className="mx-auto max-w-3xl px-3 pb-4"><Button onClick={onBack}>Back</Button></div></>;
  } else if (lobby.phase === 'lobby') {
    body = <WaitingRoom lobby={lobby} me={me} act={act} onBack={onBack} />;
  } else {
    body = <Screen title={lobby.phase}><Panel><p className="text-sm text-muted">No screen for this phase yet.</p></Panel><Button onClick={onBack}>Back</Button></Screen>;
  }

  return <>{banner}{body}</>;
}

type RoomProps = { lobby: LobbyDoc; me: Me; act: Act; onBack: () => void };

// Seating before the start. A duel is two seats, not two teams of one: its
// sides are fixed by who sits, so it seats like an ffa.
export function WaitingRoom({ lobby, me, act, onBack }: RoomProps) {
  const mine = seatOf(lobby, me.uid);
  const isHost = lobby.host_discord_id === me.uid;
  const empty = firstEmptySeat(lobby);
  const rev = { expected_revision: lobby.revision };
  const teams = lobby.game_type === 'duel' ? null : (lobby.number_teams ?? null);
  const seatAt = (i: number) => lobby.seats.find((s) => s.seat_index === i);
  const unassigned = lobby.seats.filter((s) => s.team === null || s.team === undefined);

  const seatRow = (seat: Seat | undefined, index: number, captain = false) => (
    <li
      key={index}
      className={[
        'flex items-center justify-between gap-2 rounded border border-line/60 px-2 py-1.5 text-sm',
        seat?.discord_id === me.uid ? 'border-accent/50 bg-accent/5' : 'bg-panel/60',
      ].join(' ')}
    >
      <span className="flex items-center gap-2">
        <span className="w-4 text-right text-xs text-muted">{index + 1}</span>
        <span className={seat ? '' : 'text-muted'}>{seat ? nameOf(seat) : 'empty'}</span>
      </span>
      <span className="text-[10px] uppercase tracking-wider text-muted">
        {seat?.discord_id === lobby.host_discord_id ? 'host' : captain ? 'captain' : ''}
      </span>
    </li>
  );

  return (
    <Screen
      title={`LOBBY \u2014 ${lobby.edition.toUpperCase()} ${lobby.game_type}`}
      meta={`${lobby.seats.length}/${lobby.seat_count} seated \u00b7 needs ${lobby.min_seats}`}
    >
      {lobby.host_rules && (
        <Panel className="py-2 text-sm text-muted">{lobby.host_rules}</Panel>
      )}

      {teams === null ? (
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {Array.from({ length: lobby.seat_count }, (_, i) => seatRow(seatAt(i), i))}
        </ul>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: teams }, (_, team) => {
            const side = lobby.seats.filter((s) => s.team === team).sort((a, b) => a.seat_index - b.seat_index);

            return (
              <Panel key={team} className="flex flex-col gap-2 py-3">
                <h2 className="text-xs uppercase tracking-wider text-muted">Team {team + 1}</h2>
                <ul className="flex flex-col gap-1.5">
                  {side.map((s, place) => seatRow(s, s.seat_index, place === 0 && (lobby.team_size ?? 1) > 1))}
                </ul>
                {(!mine || mine.team !== team) && (mine || empty !== null) && (
                  <Button
                    onClick={() =>
                      act('PATCH', '/seats', { ...rev, action: 'place', seat_index: mine?.seat_index ?? empty, team })
                    }
                  >
                    {mine ? 'Switch here' : 'Join here'}
                  </Button>
                )}
              </Panel>
            );
          })}
          {unassigned.length > 0 && (
            <Panel className="py-3">
              <h2 className="text-xs uppercase tracking-wider text-muted">No team yet</h2>
              <ul className="mt-2 flex flex-col gap-1.5">
                {unassigned.map((s) => seatRow(s, s.seat_index))}
              </ul>
            </Panel>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {teams === null && !mine && empty !== null && (
          <Button variant="primary" onClick={() => act('PATCH', '/seats', { ...rev, action: 'place', seat_index: empty })}>
            Take a seat
          </Button>
        )}
        {mine && !isHost && (
          <Button variant="danger" onClick={() => act('PATCH', '/seats', { ...rev, action: 'leave' })}>Leave</Button>
        )}
        {isHost && (
          <Button variant="primary" disabled={lobby.seats.length < lobby.min_seats} onClick={() => act('POST', '/start', rev)}>
            Start
          </Button>
        )}
        <Button onClick={onBack}>Back</Button>
      </div>
    </Screen>
  );
}
