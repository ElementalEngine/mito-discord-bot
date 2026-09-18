import { useState } from 'react';

import type { LobbyDoc, Seat } from '../model.js';
import { Button, Panel, Screen } from '../ui/index.js';

export type Question = { id: string; title: string; options: { id: string; label: string; emoji?: string }[]; default?: string };
type Selections = Record<string, string>;
type Props = {
  lobby: LobbyDoc & { questions?: Question[]; ballots_submitted?: number };
  mine: Seat | undefined;
  act: (method: string, path: string, body: unknown) => Promise<unknown>;
};

// One row per question, one button per option. Vote submits the ballot;
// Next marks the seat ready. The server advances the phase when all are.
export function SettingsScreen({ lobby, mine, act }: Props) {
  const questions = lobby.questions ?? [];
  const submitted = (mine?.ballot as Selections | undefined) ?? null;
  const [draft, setDraft] = useState<Selections>(
    () => submitted ?? Object.fromEntries(questions.map((q) => [q.id, q.default ?? q.options[0]?.id ?? ''])),
  );
  const rev = { expected_revision: lobby.revision };
  const seated = lobby.seats.length;

  return (
    <Screen
      title={`SETTINGS — ${lobby.edition.toUpperCase()} ${lobby.game_type}`}
      meta={`${lobby.ballots_submitted ?? 0}/${seated} ballots · ${lobby.seats.filter((s) => s.ready).length}/${seated} ready · rev ${lobby.revision}`}
    >
      <div className="grid gap-2 sm:grid-cols-2">
        {questions.map((q) => (
          <Panel key={q.id} className="py-3">
            <p className="mb-2 text-sm font-medium">{q.title}</p>
            <div className="flex flex-wrap gap-1.5">
              {q.options.map((o) => (
                <button
                  key={o.id}
                  disabled={mine?.ready === true}
                  onClick={() => setDraft({ ...draft, [q.id]: o.id })}
                  className={[
                    'rounded-md border px-2 py-1 text-xs transition-colors disabled:opacity-40',
                    draft[q.id] === o.id
                      ? 'border-accent bg-accent/15 text-ink'
                      : 'border-line bg-surface text-muted hover:border-accent/50',
                  ].join(' ')}
                >
                  {o.emoji && <span className="mr-1">{o.emoji}</span>}
                  {o.label}
                </button>
              ))}
            </div>
          </Panel>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {mine && !mine.ready && (
          <>
            <Button variant="primary" onClick={() => act('PUT', '/votes', { ...rev, selections: draft })}>
              {submitted ? 'Update vote' : 'Vote'}
            </Button>
            <Button disabled={!submitted} onClick={() => act('PUT', '/ready', rev)}>Next</Button>
          </>
        )}
      </div>
      {mine?.ready && <p className="text-sm text-muted">Waiting for the others…</p>}
      {!mine && <p className="text-sm text-muted">You are not seated in this lobby.</p>}
    </Screen>
  );
}
