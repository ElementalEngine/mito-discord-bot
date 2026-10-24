import { useState } from 'react';

import { type CivData, civOf, displayOf, type LobbyDoc, nameOf, rowsOf, type Seat, statusOf } from '../model.js';
import type { Me } from '../whoami.js';
import { Button, Countdown, Panel, Screen, SeatStatus, Tile } from '../ui/index.js';

type Props = {
  civData: CivData;
  lobby: LobbyDoc;
  me: Me;
  mine: Seat | undefined;
  act: (method: string, path: string, body: unknown) => Promise<unknown>;
};

// Standard and blind give each seat its own pool and keep picks private until all
// are in; cwc shares one pool and the captains pick in turn. A pick is sent once.
export function DraftScreen({ civData, lobby, me, mine, act }: Props) {
  const [leader, setLeader] = useState<string | null>(null);
  const [civ, setCiv] = useState<string | null>(null);

  const rows = rowsOf(civData);
  const rev = { expected_revision: lobby.revision };
  const cwc = lobby.settings?.draft_mode === 'cwc';
  const teams = lobby.teams ?? [];
  const taken = new Set(teams.flatMap((t) => [...t.leaders, ...t.civs]));
  const actor = lobby.pick_order?.[lobby.turn_index ?? 0];

  const leaders = cwc ? (lobby.pool ?? []).filter((t) => !taken.has(t)) : (mine?.pool ?? []);
  const civs = cwc ? (lobby.civ_pool ?? []).filter((t) => !taken.has(t)) : (mine?.civ_pool ?? []);
  const needsCiv = civs.length > 0;
  const picked = mine?.pick as string | undefined;
  const canPick = cwc ? actor === me.uid : Boolean(mine) && !picked;
  const ready = leader !== null && (!needsCiv || civ !== null);

  const lockIn = () =>
    act('PUT', '/picks', { ...rev, token: leader, ...(needsCiv ? { civ_token: civ } : {}) }).then(() => {
      setLeader(null);
      setCiv(null);
    });

  const grid = (tokens: string[], chosen: string | null, choose: (t: string) => void) => (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 md:grid-cols-6">
      {tokens.map((token) => (
        <Tile
          key={token}
          emojiId={rows.get(token)?.emoji_id}
          label={displayOf(rows, token)}
          sub={civOf(rows, token)}
          selected={chosen === token}
          disabled={!canPick}
          onClick={() => choose(token)}
        />
      ))}
    </div>
  );

  const total = lobby.pick_order?.length ?? 0;
  const meta = cwc
    ? `Pick ${Math.min((lobby.turn_index ?? 0) + 1, total)} of ${total} \u00b7 `
    : `${lobby.seats.filter((s) => s.ready).length}/${lobby.seats.length} locked in \u00b7 `;

  return (
    <Screen
      title={`DRAFT \u2014 ${lobby.edition.toUpperCase()} ${lobby.game_type}`}
      meta={
        <>
          {meta}
          <Countdown until={lobby.turn_expires_at} />
        </>
      }
    >
      {!mine && <Panel><p className="text-sm text-muted">You are not seated in this lobby.</p></Panel>}

      {!cwc && mine && picked && (
        <Panel className="flex items-center gap-3">
          <div className="w-20"><Tile emojiId={rows.get(picked)?.emoji_id} label={displayOf(rows, picked)} sub={civOf(rows, picked)} selected /></div>
          <div>
            <p className="font-semibold text-accent">Locked in</p>
            {typeof mine.civ_pick === 'string' && <p className="text-sm">{displayOf(rows, mine.civ_pick)}</p>}
            <p className="text-sm text-muted">Picks are shown when everyone has chosen.</p>
          </div>
        </Panel>
      )}

      {(cwc || (mine && !picked)) && (
        <Panel className="flex flex-wrap items-center justify-between gap-3 py-3">
          <p className="text-sm">
            {cwc && !canPick ? (
              <>Waiting on {nameOf(lobby.seats.find((s) => s.discord_id === actor) ?? (actor ? { discord_id: actor } : undefined))}</>
            ) : (
              <>
                <span className="font-semibold text-accent">{cwc ? 'Your pick' : 'Your pool'}</span>
                {` \u2014 choose a leader${needsCiv ? ' and a civ' : ''}`}
              </>
            )}
          </p>
          {canPick && (
            <Button variant="primary" disabled={!ready} onClick={lockIn}>
              Lock in
            </Button>
          )}
        </Panel>
      )}

      {cwc && teams.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2">
          {teams.map((t) => (
            <Panel key={t.team_index} className="py-3">
              <h2 className="mb-1 text-xs uppercase tracking-wider text-muted">Team {t.team_index + 1}</h2>
              <p className="text-sm">
                {t.leaders.length
                  ? t.leaders.map((l, i) => (t.civs[i] ? `${displayOf(rows, l)} (${displayOf(rows, t.civs[i])})` : displayOf(rows, l))).join(' \u00b7 ')
                  : 'no picks yet'}
              </p>
            </Panel>
          ))}
        </div>
      )}

      {(cwc || (mine && !picked)) && (
        <>
          <h2 className="text-xs uppercase tracking-wider text-muted">Leaders</h2>
          {grid(leaders, leader, setLeader)}
          {needsCiv && (
            <>
              <h2 className="text-xs uppercase tracking-wider text-muted">Civilizations</h2>
              {grid(civs, civ, setCiv)}
            </>
          )}
        </>
      )}

      {!cwc && <SeatStatus rows={statusOf(lobby, 'locked in', 'choosing\u2026')} />}
    </Screen>
  );
}
