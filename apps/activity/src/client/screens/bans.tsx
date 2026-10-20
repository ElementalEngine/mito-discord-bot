import { useState } from 'react';

import { type CivData, type CivRow, civOf, displayOf, type LobbyDoc, nameOf, rowsOf, type Seat, statusOf } from '../model.js';
import type { Me } from '../whoami.js';
import { Button, Countdown, Panel, Screen, SeatStatus, Tile } from '../ui/index.js';

type Props = {
  civData: CivData;
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

// The server's rule (bans.resolve_bans): a ban lands when a strict majority
// of seated players chose it. Said up front, so an unmatched ban is expected.
export const banRule = (players: number): string => {
  const need = Math.floor(players / 2) + 1;
  return players === 2
    ? 'A ban lands only when both players choose it.'
    : `A ban lands when ${need} of ${players} players choose it.`;
};

export function BansScreen({ civData, lobby, me, mine, act }: Props) {
  const submitted = (mine?.bans as { leader_keys: string[]; civ_keys: string[] } | undefined) ?? null;
  const [leaders, setLeaders] = useState<string[]>(submitted?.leader_keys ?? []);
  const [civs, setCivs] = useState<string[]>(submitted?.civ_keys ?? []);
  const [search, setSearch] = useState('');

  const rows = rowsOf(civData);
  const caps = lobby.ban_caps ?? { leader: 0, civ: 0 };
  const rev = { expected_revision: lobby.revision };
  const inTurns = Array.isArray(lobby.ban_order);
  const actor = lobby.ban_order?.[lobby.turn_index ?? 0];
  const myTurn = inTurns && actor === me.uid;
  const locked = inTurns ? !myTurn : mine?.ready === true;
  const landed = [...(lobby.bans?.leader ?? []), ...(lobby.bans?.civ ?? [])];
  const wanted = search.trim().toLowerCase();

  // A turn bans exactly one leader, and one civ as well in civ7; the whole-set
  // path bans up to the cap. One selection model, two limits.
  const leaderCap = inTurns ? 1 : caps.leader;
  const civCap = inTurns ? (lobby.edition === 'civ7' ? 1 : 0) : caps.civ;
  const toggle = (list: string[], set: (v: string[]) => void, cap: number, key: string) => {
    if (list.includes(key)) return set(list.filter((k) => k !== key));
    if (cap === 1) return set([key]);
    if (list.length < cap) set([...list, key]);
  };
  const matches = (r: CivRow) =>
    !wanted || `${displayOf(rows, r.token)} ${civOf(rows, r.token) ?? ''}`.toLowerCase().includes(wanted);
  const grid = (source: CivRow[], picked: string[], set: (v: string[]) => void, cap: number) => (
    <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6 md:grid-cols-8">
      {source
        .filter((r) => !landed.includes(r.token) && (picked.includes(r.token) || matches(r)))
        .map((r) => (
          <Tile
            key={r.token}
            emojiId={r.emoji_id}
            label={displayOf(rows, r.token)}
            sub={civOf(rows, r.token)}
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

  const ready = lobby.seats.filter((s) => s.ready).length;

  return (
    <Screen
      title={`BANS \u2014 ${lobby.edition.toUpperCase()} ${lobby.game_type}`}
      meta={
        <>
          {inTurns
            ? `Turn ${(lobby.turn_index ?? 0) + 1} of ${lobby.ban_order?.length} \u00b7 `
            : `${ready}/${lobby.seats.length} ready \u00b7 `}
          <Countdown until={lobby.turn_expires_at} />
        </>
      }
    >
      {!inTurns && <p className="text-xs text-muted">{banRule(lobby.seats.length)} Your bans stay private until then.</p>}

      <Panel className="flex flex-wrap items-center justify-between gap-3 py-3">
        <p className="text-sm">
          {inTurns ? (
            myTurn ? (
              <span className="font-semibold text-accent">Your ban</span>
            ) : (
              <>Waiting on {nameOf(lobby.seats.find((s) => s.discord_id === actor) ?? (actor ? { discord_id: actor } : undefined))}</>
            )
          ) : locked ? (
            <>Waiting for the others{'\u2026'}</>
          ) : (
            `Leaders ${leaders.length}/${leaderCap}${civCap > 0 ? ` \u00b7 Civs ${civs.length}/${civCap}` : ''}`
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

      {!inTurns && <SeatStatus rows={statusOf(lobby, 'ready', 'banning\u2026')} />}

      {landed.length > 0 && (
        <p className="text-xs text-muted">Banned: {landed.map((t) => displayOf(rows, t)).join(' \u00b7 ')}</p>
      )}

      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search leaders and civs"
        className="w-full rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink placeholder:text-muted"
      />

      <h2 className="text-xs uppercase tracking-wider text-muted">Leaders</h2>
      {grid(civData.leaders, leaders, setLeaders, leaderCap)}
      {civCap > 0 && (
        <>
          <h2 className="text-xs uppercase tracking-wider text-muted">Civilizations</h2>
          {grid(civData.civs, civs, setCivs, civCap)}
        </>
      )}
      {!mine && <p className="text-sm text-muted">You are not seated in this lobby.</p>}
    </Screen>
  );
}
