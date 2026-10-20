import { useState } from 'react';

import type { LobbyDoc, Seat } from '../model.js';
import { Button, Countdown, Panel, Screen } from '../ui/index.js';

export type Question = {
  id: string;
  title: string;
  options: { id: string; label: string; emoji?: string }[];
  default_option_id?: string;
  // More than one means a seat may back several options, joined by '|'.
  max_selections?: number;
};
type Selections = Record<string, string>;
type Props = {
  lobby: LobbyDoc & { questions?: Question[]; ballots_submitted?: number };
  mine: Seat | undefined;
  act: (method: string, path: string, body: unknown) => Promise<unknown>;
};

const SEPARATOR = '|';

// A ballot must answer every question: one unanswered question sends that
// question to its default for everyone. So a choice can be swapped, never
// emptied, and a full multi-choice drops its oldest pick.
export const choose = (current: string, option: string, max: number): string => {
  const chosen = current ? current.split(SEPARATOR) : [];
  if (max <= 1) return option;
  if (chosen.includes(option)) return chosen.length > 1 ? chosen.filter((c) => c !== option).join(SEPARATOR) : current;
  return [...chosen, option].slice(-max).join(SEPARATOR);
};

// One row per question, one button per option. Vote submits the ballot;
// Next marks the seat ready. The server advances the phase when all are.
export function SettingsScreen({ lobby, mine, act }: Props) {
  const questions = lobby.questions ?? [];
  const submitted = (mine?.ballot as Selections | undefined) ?? null;
  const [draft, setDraft] = useState<Selections>(
    () => submitted ?? Object.fromEntries(questions.map((q) => [q.id, q.default_option_id ?? q.options[0]?.id ?? ''])),
  );
  const rev = { expected_revision: lobby.revision };
  const seated = lobby.seats.length;

  return (
    <Screen
      title={`SETTINGS \u2014 ${lobby.edition.toUpperCase()} ${lobby.game_type}`}
      meta={
        <>
          {`${lobby.ballots_submitted ?? 0}/${seated} voted \u00b7 ${lobby.seats.filter((s) => s.ready).length}/${seated} ready \u00b7 `}
          <Countdown until={lobby.turn_expires_at} />
        </>
      }
    >
      <div className="grid items-start gap-2 sm:grid-cols-2">
        {questions.map((q) => {
          const max = q.max_selections ?? 1;
          const picked = (draft[q.id] ?? '').split(SEPARATOR);

          return (
            <Panel key={q.id} className="py-3">
              <p className="mb-2 text-sm font-medium">
                {q.title}
                {max > 1 && <span className="ml-1 text-xs font-normal text-muted">(up to {max})</span>}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {q.options.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    disabled={mine?.ready === true}
                    onClick={() => setDraft({ ...draft, [q.id]: choose(draft[q.id] ?? '', o.id, max) })}
                    className={[
                      'rounded-md border px-2 py-1 text-xs transition-colors disabled:opacity-40',
                      picked.includes(o.id)
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
          );
        })}
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
      {mine?.ready && <p className="text-sm text-muted">Waiting for the others{'\u2026'}</p>}
      {!mine && <p className="text-sm text-muted">You are not seated in this lobby.</p>}
    </Screen>
  );
}
