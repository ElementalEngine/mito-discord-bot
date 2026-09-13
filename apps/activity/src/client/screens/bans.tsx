import { useEffect, useState } from 'react';

import type { LobbyDoc, Seat } from '../model.js';
import type { Me } from '../whoami.js';
import type { ApiClient } from '../transport/client.js';
import { pretty } from './draft.js';

type Leader = { token: string; name: string; civ: string };
type CivData = { leaders: Leader[]; civs: { token: string; name: string }[] };
type Props = {
  api: ApiClient;
  lobby: LobbyDoc & {
    ban_caps?: { leader: number; civ: number };
    ban_order?: string[];
    turn_index?: number;
    bans?: { leader?: string[]; civ?: string[] };
  };
  me: Me;
  mine: Seat | undefined;
  act: (method: string, path: string, body: unknown) => Promise<unknown>;
};


export function BansScreen({ api, lobby, me, mine, act }: Props) {
  const [data, setData] = useState<CivData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const submitted = (mine?.bans as { leader_keys: string[]; civ_keys: string[] } | undefined) ?? null;
  const [leaders, setLeaders] = useState<string[]>(submitted?.leader_keys ?? []);
  const [civs, setCivs] = useState<string[]>(submitted?.civ_keys ?? []);

  useEffect(() => {
    api.request<CivData>('GET', `/civ-data/${lobby.edition}`)
      .then((r) => setData(r.body))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [api, lobby.edition]);

  if (error) return <p>Could not load civ data: {error}</p>;
  if (!data) return <p>Loading civ data…</p>;

  const caps = lobby.ban_caps ?? { leader: 0, civ: 0 };
  const rev = { expected_revision: lobby.revision };
  const inTurns = Array.isArray(lobby.ban_order);
  const myTurn = inTurns && lobby.ban_order?.[lobby.turn_index ?? 0] === me.uid;
  const locked = inTurns ? !myTurn : mine?.ready === true;
  const landed = [...(lobby.bans?.leader ?? []), ...(lobby.bans?.civ ?? [])];

  // A turn bans exactly one leader, and one civ as well in civ7; the whole-set
  // path bans up to the cap. One selection model, two limits.
  const leaderCap = inTurns ? 1 : caps.leader;
  const civCap = inTurns ? (lobby.edition === 'civ7' ? 1 : 0) : caps.civ;
  const toggle = (list: string[], set: (v: string[]) => void, cap: number, key: string) => {
    if (list.includes(key)) return set(list.filter((k) => k !== key));
    if (cap === 1) return set([key]);
    if (list.length < cap) set([...list, key]);
  };
  const grid = (rows: { token: string }[], picked: string[], set: (v: string[]) => void, cap: number) => (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
      {rows
        .filter((r) => !landed.includes(r.token))
        .map((r) => (
          <button key={r.token} disabled={locked} onClick={() => toggle(picked, set, cap, r.token)}
            style={{ fontWeight: picked.includes(r.token) ? 'bold' : 'normal', opacity: picked.includes(r.token) ? 1 : 0.7 }}>
            {pretty(r.token)}
          </button>
        ))}
    </div>
  );
  const submit = () =>
    act('PUT', '/bans', { ...rev, leader_keys: leaders, civ_keys: civs }).then(() => {
      if (inTurns) {
        setLeaders([]);
        setCivs([]);
      }
    });

  return (
    <section>
      <h2>BANS — {lobby.edition.toUpperCase()} {lobby.game_type}</h2>
      {inTurns ? (
        <p>
          Turn {(lobby.turn_index ?? 0) + 1} of {lobby.ban_order?.length} —{' '}
          {myTurn ? <strong>your ban</strong> : <>waiting on {lobby.ban_order?.[lobby.turn_index ?? 0]}</>} · rev {lobby.revision}
        </p>
      ) : (
        <p>{lobby.seats.filter((s) => s.ready).length}/{lobby.seats.length} ready · rev {lobby.revision}</p>
      )}
      {landed.length > 0 && <p>Banned so far: {landed.map(pretty).join(', ')}</p>}
      <h3>Leaders — {leaders.length}/{leaderCap}</h3>
      {grid(data.leaders, leaders, setLeaders, leaderCap)}
      {civCap > 0 && (<><h3>Civs — {civs.length}/{civCap}</h3>{grid(data.civs, civs, setCivs, civCap)}</>)}
      {inTurns && myTurn && (
        <button disabled={leaders.length !== 1 || civs.length !== civCap} onClick={submit}>
          Ban
        </button>
      )}
      {!inTurns && mine && !locked && (
        <>
          <button onClick={submit}>{submitted ? 'Update bans' : 'Submit bans'}</button>{' '}
          <button disabled={!submitted} onClick={() => act('PUT', '/ready', rev)}>Next</button>
        </>
      )}
      {locked && <p>{inTurns ? 'Not your turn.' : 'Waiting for the others…'}</p>}
      {!mine && <p>You are not seated in this lobby.</p>}
    </section>
  );
}
