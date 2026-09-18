import { useEffect, useState } from 'react';

import type { LobbyDoc, Seat } from '../model.js';
import type { ApiClient } from '../transport/client.js';
import { Panel, Screen, Tile } from '../ui/index.js';

type Props = {
  api: ApiClient;
  lobby: LobbyDoc;
  mine: Seat | undefined;
  act: (method: string, path: string, body: unknown) => Promise<unknown>;
};

export const pretty = (token: string) =>
  token.replace(/^(LEADER|CIVILIZATION)_/, '').toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

type Row = { token: string; civ?: string | null; emoji_id?: string | null };

// Your dealt pool; pick one. Other seats' pools are censored by the server,
// so this screen only ever knows its own.
export function DraftScreen({ api, lobby, mine, act }: Props) {
  const [art, setArt] = useState<Map<string, Row>>(new Map());

  useEffect(() => {
    api
      .request<{ leaders: Row[]; civs: Row[] }>('GET', `/civ-data/${lobby.edition}`)
      .then((r) => setArt(new Map([...(r.body?.leaders ?? []), ...(r.body?.civs ?? [])].map((x) => [x.token, x]))))
      .catch(() => setArt(new Map()));
  }, [api, lobby.edition]);

  const pool = (mine?.pool as string[] | undefined) ?? [];
  const pick = mine?.pick as string | undefined;
  const picked = lobby.seats.filter((s) => s.pick != null).length;
  const rev = { expected_revision: lobby.revision };

  return (
    <Screen
      title={`DRAFT — ${lobby.edition.toUpperCase()} ${lobby.game_type}`}
      meta={`${picked}/${lobby.seats.length} picked · rev ${lobby.revision}`}
    >
      {!mine && <Panel><p className="text-sm text-muted">You are not seated in this lobby.</p></Panel>}

      {mine && pick && (
        <Panel className="flex items-center gap-3">
          <Tile emojiId={art.get(pick)?.emoji_id} label={pretty(pick)} sub={art.get(pick)?.civ ? pretty(art.get(pick)!.civ!) : undefined} selected />
          <div>
            <p className="font-semibold text-accent">Picked</p>
            <p className="text-sm text-muted">Waiting for the others…</p>
          </div>
        </Panel>
      )}

      {mine && !pick && (
        <>
          <p className="text-xs uppercase tracking-wider text-muted">Your pool — choose one</p>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 md:grid-cols-6">
            {pool.map((token) => (
              <Tile
                key={token}
                emojiId={art.get(token)?.emoji_id}
                label={pretty(token)}
                sub={art.get(token)?.civ ? pretty(art.get(token)!.civ!) : undefined}
                onClick={() => act('PUT', '/picks', { ...rev, token })}
              />
            ))}
          </div>
        </>
      )}

      <ol className="mt-2 space-y-1 text-sm">
        {[...lobby.seats].sort((a, b) => a.seat_index - b.seat_index).map((s) => (
          <li key={s.seat_index} className="flex justify-between border-b border-line/50 py-1">
            <span>{s.name ?? s.discord_id}</span>
            <span className={s.pick ? 'text-ink' : 'text-muted'}>{s.pick ? pretty(String(s.pick)) : 'choosing…'}</span>
          </li>
        ))}
      </ol>
    </Screen>
  );
}
