import { type LobbyDoc, nameOf } from '../model.js';
import { pretty } from './draft.js';

type Props = { lobby: LobbyDoc & { settings?: Record<string, string>; bans?: { leader?: string[]; civ?: string[] }; cancel_reason?: string } };

// Outcomes only, no vote counts: settings, bans, and every seat's pick.
export function CompleteScreen({ lobby }: Props) {
  if (lobby.phase === 'cancelled') return <section><h2>CANCELLED</h2><p>{lobby.cancel_reason ?? 'no reason recorded'}</p></section>;
  const settings = Object.entries(lobby.settings ?? {});
  const banned = [...(lobby.bans?.leader ?? []), ...(lobby.bans?.civ ?? [])];
  return (
    <section>
      <h2>COMPLETE — {lobby.edition.toUpperCase()} {lobby.game_type}</h2>
      {settings.length > 0 && (<><h3>Settings</h3><ul>{settings.map(([k, v]) => <li key={k}>{k}: {v}</li>)}</ul></>)}
      <h3>Bans</h3><p>{banned.length ? banned.map(pretty).join(', ') : 'none'}</p>
      <h3>Picks</h3>
      <ol>{[...lobby.seats].sort((a, b) => a.seat_index - b.seat_index).map((s) => (
        <li key={s.seat_index}>{nameOf(s)} — {s.pick ? pretty(String(s.pick)) : '—'}</li>
      ))}</ol>
    </section>
  );
}
