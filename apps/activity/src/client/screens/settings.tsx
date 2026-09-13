import { useState } from 'react';

import type { LobbyDoc, Seat } from '../model.js';

export type Question = { id: string; prompt: string; options: { id: string; label: string }[]; default: string };
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
    () => submitted ?? Object.fromEntries(questions.map((q) => [q.id, q.default])),
  );
  const rev = { expected_revision: lobby.revision };
  const seated = lobby.seats.length;

  return (
    <section>
      <h2>SETTINGS — {lobby.edition.toUpperCase()} {lobby.game_type}</h2>
      <p>
        {lobby.ballots_submitted ?? 0}/{seated} ballots in · {lobby.seats.filter((s) => s.ready).length}/{seated} ready · rev {lobby.revision}
      </p>
      {questions.map((q) => (
        <div key={q.id} style={{ marginBottom: 10 }}>
          <strong>{q.prompt}</strong>
          <div>
            {q.options.map((o) => (
              <button
                key={o.id}
                disabled={mine?.ready === true}
                onClick={() => setDraft({ ...draft, [q.id]: o.id })}
                style={{ marginRight: 4, fontWeight: draft[q.id] === o.id ? 'bold' : 'normal' }}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      ))}
      {mine && !mine.ready && (
        <>
          <button onClick={() => act('PUT', '/votes', { ...rev, selections: draft })}>
            {submitted ? 'Update vote' : 'Vote'}
          </button>{' '}
          <button disabled={!submitted} onClick={() => act('PUT', '/ready', rev)}>
            Next
          </button>
        </>
      )}
      {mine?.ready && <p>Waiting for the others…</p>}
      {!mine && <p>You are not seated in this lobby.</p>}
    </section>
  );
}
