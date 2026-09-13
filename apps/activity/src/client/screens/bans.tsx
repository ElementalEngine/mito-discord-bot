import { useEffect, useState } from 'react';

import type { LobbyDoc, Seat } from '../model.js';
import type { ApiClient } from '../transport/client.js';

type Leader = { token: string; name: string; civ: string };
type CivData = { leaders: Leader[]; civs: { token: string; name: string }[] };
type Props = {
  api: ApiClient;
  lobby: LobbyDoc & { ban_caps?: { leader: number; civ: number }; ban_order?: unknown };
  mine: Seat | undefined;
  act: (method: string, path: string, body: unknown) => Promise<unknown>;
};

const pretty = (token: string) =>
  token.replace(/^(LEADER|CIVILIZATION)_/, '').toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export function BansScreen({ api, lobby, mine, act }: Props) {
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

  if (lobby.ban_order) return <p>CWC captain turns — screen not built yet.</p>;
  if (error) return <p>Could not load civ data: {error}</p>;
  if (!data) return <p>Loading civ data…</p>;

  const caps = lobby.ban_caps ?? { leader: 0, civ: 0 };
  const rev = { expected_revision: lobby.revision };
  const locked = mine?.ready === true;
  const toggle = (list: string[], set: (v: string[]) => void, cap: number, key: string) => {
    if (list.includes(key)) return set(list.filter((k) => k !== key));
    if (list.length < cap) set([...list, key]);
  };
  const grid = (rows: { token: string }[], picked: string[], set: (v: string[]) => void, cap: number) => (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
      {rows.map((r) => (
        <button key={r.token} disabled={locked} onClick={() => toggle(picked, set, cap, r.token)}
          style={{ fontWeight: picked.includes(r.token) ? 'bold' : 'normal', opacity: picked.includes(r.token) ? 1 : 0.7 }}>
          {pretty(r.token)}
        </button>
      ))}
    </div>
  );

  return (
    <section>
      <h2>BANS — {lobby.edition.toUpperCase()} {lobby.game_type}</h2>
      <p>{lobby.seats.filter((s) => s.ready).length}/{lobby.seats.length} ready · rev {lobby.revision}</p>
      <h3>Leaders — {leaders.length}/{caps.leader}</h3>
      {grid(data.leaders, leaders, setLeaders, caps.leader)}
      {caps.civ > 0 && (<><h3>Civs — {civs.length}/{caps.civ}</h3>{grid(data.civs, civs, setCivs, caps.civ)}</>)}
      {mine && !locked && (
        <>
          <button onClick={() => act('PUT', '/bans', { ...rev, leader_keys: leaders, civ_keys: civs })}>
            {submitted ? 'Update bans' : 'Submit bans'}
          </button>{' '}
          <button disabled={!submitted} onClick={() => act('PUT', '/ready', rev)}>Next</button>
        </>
      )}
      {locked && <p>Waiting for the others…</p>}
      {!mine && <p>You are not seated in this lobby.</p>}
    </section>
  );
}
