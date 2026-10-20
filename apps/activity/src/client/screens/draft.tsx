import { type CivData, civOf, displayOf, type LobbyDoc, nameOf, rowsOf, type Seat } from '../model.js';
import { Countdown, Panel, Screen, Tile } from '../ui/index.js';

type Props = {
  civData: CivData;
  lobby: LobbyDoc;
  mine: Seat | undefined;
  act: (method: string, path: string, body: unknown) => Promise<unknown>;
};

// Your dealt pool; pick one. The server withholds every other seat's pick
// until the draft closes, so a late picker cannot counter-pick: this screen
// knows only its own pick, and who else has locked in.
export function DraftScreen({ civData, lobby, mine, act }: Props) {
  const rows = rowsOf(civData);

  const pool = (mine?.pool as string[] | undefined) ?? [];
  const pick = mine?.pick as string | undefined;
  const locked = lobby.seats.filter((s) => s.ready).length;
  const rev = { expected_revision: lobby.revision };

  return (
    <Screen
      title={`DRAFT \u2014 ${lobby.edition.toUpperCase()} ${lobby.game_type}`}
      meta={
        <>
          {`${locked}/${lobby.seats.length} locked in \u00b7 `}
          <Countdown until={lobby.turn_expires_at} />
        </>
      }
    >
      {!mine && <Panel><p className="text-sm text-muted">You are not seated in this lobby.</p></Panel>}

      {mine && pick && (
        <Panel className="flex items-center gap-3">
          <div className="w-20"><Tile emojiId={rows.get(pick)?.emoji_id} label={displayOf(rows, pick)} sub={civOf(rows, pick)} selected /></div>
          <div>
            <p className="font-semibold text-accent">Locked in</p>
            <p className="text-sm text-muted">Picks are shown when everyone has chosen.</p>
          </div>
        </Panel>
      )}

      {mine && !pick && (
        <>
          <p className="text-xs uppercase tracking-wider text-muted">Your pool {'\u2014'} choose one</p>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 md:grid-cols-6">
            {pool.map((token) => (
              <Tile
                key={token}
                emojiId={rows.get(token)?.emoji_id}
                label={displayOf(rows, token)}
                sub={civOf(rows, token)}
                onClick={() => act('PUT', '/picks', { ...rev, token })}
              />
            ))}
          </div>
        </>
      )}

      <ol className="mt-2 space-y-1 text-sm">
        {[...lobby.seats].sort((a, b) => a.seat_index - b.seat_index).map((s) => (
          <li key={s.seat_index} className="flex justify-between border-b border-line/50 py-1">
            <span>{nameOf(s)}</span>
            <span className={s.ready ? 'text-ink' : 'text-muted'}>{s.ready ? 'locked in' : 'choosing\u2026'}</span>
          </li>
        ))}
      </ol>
    </Screen>
  );
}
