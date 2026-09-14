import { useEffect, useState } from 'react';

import type { LobbyDoc, Seat } from '../model.js';
import type { Me } from '../whoami.js';
import { Button, Panel, Screen, Tile } from '../ui/index.js';
import type { ApiClient } from '../transport/client.js';
import { pretty } from './draft.js';

type Leader = { token: string; name: string; civ: string | null; emoji_id?: string | null };
type CivData = { leaders: Leader[]; civs: { token: string; name: string; emoji_id?: string | null }[] };
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
  const grid = (
    rows: { token: string; emoji_id?: string | null; civ?: string | null }[],
    picked: string[],
    set: (v: string[]) => void,
    cap: number,
  ) => (
    <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6 md:grid-cols-8">
      {rows
        .filter((r) => !landed.includes(r.token))
        .map((r) => (
          <Tile
            key={r.token}
            emojiId={r.emoji_id}
            label={pretty(r.token)}
            sub={r.civ ? pretty(r.civ) : undefined}
            selected={picked.includes(r.token)}
            disabled={locked || (!picked.includes(r.token) && picked.length >= cap && cap !== 1)}
            onClick={() => toggle(picked, set, cap, r.token)}
          />
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
    <Screen
      title={`BANS — ${lobby.edition.toUpperCase()} ${lobby.game_type}`}
      meta={
        inTurns
          ? `Turn ${(lobby.turn_index ?? 0) + 1} of ${lobby.ban_order?.length} · rev ${lobby.revision}`
          : `${lobby.seats.filter((s) => s.ready).length}/${lobby.seats.length} ready · rev ${lobby.revision}`
      }
    >
      <Panel className="flex flex-wrap items-center justify-between gap-3 py-3">
        <p className="text-sm">
          {inTurns ? (
            myTurn ? <span className="font-semibold text-accent">Your ban</span> : <>Waiting on {lobby.ban_order?.[lobby.turn_index ?? 0]}</>
          ) : locked ? (
            'Waiting for the others…'
          ) : (
            `Leaders ${leaders.length}/${leaderCap}${civCap > 0 ? ` · Civs ${civs.length}/${civCap}` : ''}`
          )}
        </p>
        <div className="flex gap-2">
          {inTurns && myTurn && (
            <Button variant="primary" disabled={leaders.length !== 1 || civs.length !== civCap} onClick={submit}>
              Ban
            </Button>
          )}
          {!inTurns && mine && !locked && (
            <>
              <Button variant="primary" onClick={submit}>{submitted ? 'Update bans' : 'Submit bans'}</Button>
              <Button disabled={!submitted} onClick={() => act('PUT', '/ready', rev)}>Next</Button>
            </>
          )}
        </div>
      </Panel>

      {landed.length > 0 && (
        <p className="text-xs text-muted">Banned: {landed.map(pretty).join(' · ')}</p>
      )}

      <h2 className="text-xs uppercase tracking-wider text-muted">Leaders</h2>
      {grid(data.leaders, leaders, setLeaders, leaderCap)}
      {civCap > 0 && (
        <>
          <h2 className="text-xs uppercase tracking-wider text-muted">Civilizations</h2>
          {grid(data.civs, civs, setCivs, civCap)}
        </>
      )}
      {!mine && <p className="text-sm text-muted">You are not seated in this lobby.</p>}
    </Screen>
  );
}
