import type { LobbyDoc } from '../model.js';
import { nameOf } from '../model.js';
import { Panel, Screen } from '../ui/index.js';
import { pretty } from './draft.js';

type Props = { lobby: LobbyDoc & { settings?: Record<string, string>; bans?: { leader?: string[]; civ?: string[] }; cancel_reason?: string } };

// Outcomes only, no vote counts: settings, bans, and every seat's pick.
export function CompleteScreen({ lobby }: Props) {
  if (lobby.phase === 'cancelled') {
    return (
      <Screen title="CANCELLED">
        <Panel><p className="text-sm text-muted">{lobby.cancel_reason ?? 'no reason recorded'}</p></Panel>
      </Screen>
    );
  }
  const settings = Object.entries(lobby.settings ?? {});
  const banned = [...(lobby.bans?.leader ?? []), ...(lobby.bans?.civ ?? [])];

  return (
    <Screen title={`COMPLETE — ${lobby.edition.toUpperCase()} ${lobby.game_type}`}>
      <Panel className="py-3">
        <h2 className="mb-2 text-xs uppercase tracking-wider text-muted">Picks</h2>
        <ol className="space-y-1 text-sm">
          {[...lobby.seats].sort((a, b) => a.seat_index - b.seat_index).map((s) => (
            <li key={s.seat_index} className="flex justify-between border-b border-line/40 py-1 last:border-0">
              <span>{nameOf(s)}</span>
              <span className="font-medium text-accent">{s.pick ? pretty(String(s.pick)) : '—'}</span>
            </li>
          ))}
        </ol>
      </Panel>

      {settings.length > 0 && (
        <Panel className="py-3">
          <h2 className="mb-2 text-xs uppercase tracking-wider text-muted">Settings</h2>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            {settings.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted">{k.replace(/_/g, ' ')}</dt>
                <dd>{v.replace(/_/g, ' ')}</dd>
              </div>
            ))}
          </dl>
        </Panel>
      )}

      <Panel className="py-3">
        <h2 className="mb-1 text-xs uppercase tracking-wider text-muted">Bans</h2>
        <p className="text-sm text-muted">{banned.length ? banned.map(pretty).join(' · ') : 'none'}</p>
      </Panel>
    </Screen>
  );
}
