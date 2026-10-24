import { type CivData, civOf, displayOf, type LobbyDoc, nameOf, rowsOf, type Seat } from '../model.js';
import { Panel, Screen } from '../ui/index.js';
import type { Question } from './settings.js';

type Props = {
  civData: CivData;
  lobby: LobbyDoc & {
    settings?: Record<string, string>;
    questions?: Question[];
    bans?: { leader?: string[]; civ?: string[] };
    cancel_reason?: string;
  };
};

// How a setting was decided, by the server's rule: a missing ballot means the
// default and a tied top count was drawn. Says whether it was close, never counts.
export const decidedBy = (seats: Seat[], questionId: string): 'default' | 'draw' | null => {
  const ballots = seats.map((s) => s.ballot?.[questionId]);
  if (ballots.some((b) => !b)) return 'default';
  const counts = new Map<string, number>();
  for (const b of ballots) for (const choice of String(b).split('|')) counts.set(choice, (counts.get(choice) ?? 0) + 1);
  const most = Math.max(...counts.values());
  return [...counts.values()].filter((n) => n === most).length > 1 ? 'draw' : null;
};

// Outcomes only, no vote counts: settings, bans, and every seat's pick.
export function CompleteScreen({ civData, lobby }: Props) {
  if (lobby.phase === 'cancelled') {
    return (
      <Screen title="CANCELLED">
        <Panel><p className="text-sm text-muted">{lobby.cancel_reason ?? 'no reason recorded'}</p></Panel>
      </Screen>
    );
  }
  const rows = rowsOf(civData);
  const chosen = lobby.settings ?? {};
  const questions = lobby.questions ?? [];
  // In question order, then anything the catalogue no longer names.
  const settings = [
    ...questions.filter((q) => q.id in chosen).map((q) => ({
      id: q.id,
      asked: true,
      title: q.title,
      value: q.options.find((o) => o.id === chosen[q.id])?.label ?? chosen[q.id]!,
    })),
    ...Object.keys(chosen)
      .filter((id) => !questions.some((q) => q.id === id))
      .map((id) => ({ id, asked: false, title: id.replace(/_/g, ' '), value: chosen[id]!.replace(/_/g, ' ') })),
  ];
  const banned = [...(lobby.bans?.leader ?? []), ...(lobby.bans?.civ ?? [])];
  // Cwc captains pick for their teams, so the picks live there, not on seats.
  const cwc = lobby.settings?.draft_mode === 'cwc';
  const teams = lobby.teams ?? [];

  return (
    <Screen title={`COMPLETE \u2014 ${lobby.edition.toUpperCase()} ${lobby.game_type}`}>
      <Panel className="py-3">
        <h2 className="mb-2 text-xs uppercase tracking-wider text-muted">Picks</h2>
        {cwc ? (
          <ol className="space-y-1 text-sm">
            {teams.map((t) => (
              <li key={t.team_index} className="flex justify-between gap-3 border-b border-line/40 py-1 last:border-0">
                <span>Team {t.team_index + 1}</span>
                <span className="text-right font-medium text-accent">
                  {t.leaders.map((l, i) => (t.civs[i] ? `${displayOf(rows, l)} (${displayOf(rows, t.civs[i])})` : displayOf(rows, l))).join(' \u00b7 ') || '\u2014'}
                </span>
              </li>
            ))}
          </ol>
        ) : (
        <ol className="space-y-1 text-sm">
          {[...lobby.seats].sort((a, b) => a.seat_index - b.seat_index).map((s) => {
            const pick = s.pick ? String(s.pick) : null;
            // civ7 picks its civ; a civ6 leader carries its own.
            const civ = typeof s.civ_pick === 'string' ? displayOf(rows, s.civ_pick) : pick ? civOf(rows, pick) : undefined;

            return (
              <li key={s.seat_index} className="flex justify-between border-b border-line/40 py-1 last:border-0">
                <span>{nameOf(s)}</span>
                <span className="font-medium text-accent">
                  {pick ? displayOf(rows, pick) : '\u2014'}
                  {civ && <span className="ml-1 text-xs font-normal text-muted">{civ}</span>}
                </span>
              </li>
            );
          })}
        </ol>
        )}
      </Panel>

      {settings.length > 0 && (
        <Panel className="py-3">
          <h2 className="mb-2 text-xs uppercase tracking-wider text-muted">Settings</h2>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            {settings.map((row) => {
              // A setting chosen at creation was never on the ballot.
              const how = row.asked ? decidedBy(lobby.seats, row.id) : null;

              return (
                <div key={row.id} className="contents">
                  <dt className="text-muted">{row.title}</dt>
                  <dd>
                    {row.value}
                    {how && <span className="ml-1 text-xs text-muted">({how === 'draw' ? 'tie, drawn' : 'default'})</span>}
                  </dd>
                </div>
              );
            })}
          </dl>
        </Panel>
      )}

      <Panel className="py-3">
        <h2 className="mb-1 text-xs uppercase tracking-wider text-muted">Bans</h2>
        <p className="text-sm text-muted">{banned.length ? banned.map((t) => displayOf(rows, t)).join(' \u00b7 ') : 'none'}</p>
      </Panel>
    </Screen>
  );
}
