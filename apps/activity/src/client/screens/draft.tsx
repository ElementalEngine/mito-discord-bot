import type { LobbyDoc, Seat } from '../model.js';

type Props = { lobby: LobbyDoc; mine: Seat | undefined; act: (method: string, path: string, body: unknown) => Promise<unknown> };

export const pretty = (token: string) =>
  token.replace(/^(LEADER|CIVILIZATION)_/, '').toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

// Your dealt pool; pick one. Other seats' pools are censored by the server,
// so this screen only ever knows its own.
export function DraftScreen({ lobby, mine, act }: Props) {
  const pool = (mine?.pool as string[] | undefined) ?? [];
  const pick = mine?.pick as string | undefined;
  const picked = lobby.seats.filter((s) => s.pick != null).length;
  const rev = { expected_revision: lobby.revision };
  return (
    <section>
      <h2>DRAFT — {lobby.edition.toUpperCase()} {lobby.game_type}</h2>
      <p>{picked}/{lobby.seats.length} picked · rev {lobby.revision}</p>
      {!mine && <p>You are not seated in this lobby.</p>}
      {mine && pick && <p>You picked <strong>{pretty(pick)}</strong>. Waiting for the others…</p>}
      {mine && !pick && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {pool.map((token) => (
            <button key={token} onClick={() => act('PUT', '/picks', { ...rev, token })}>{pretty(token)}</button>
          ))}
        </div>
      )}
    </section>
  );
}
