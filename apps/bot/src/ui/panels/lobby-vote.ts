import { ButtonStyle } from 'discord.js';

import type { Lobby, SettingQuestion } from '../../api/types.js';
import { field, mention, nameOf, text, when, type CivNames, type Panel } from '../kit/index.js';
import { SHAPES, VERB, button, row } from './lobby.js';

type Vote = NonNullable<Lobby['vote']>;

// The settings the host left open, each voted on its own message.
export const openQuestions = (lobby: Lobby, questions: readonly SettingQuestion[]): SettingQuestion[] =>
  questions.filter((q) => !lobby.settings.some((s) => s.id === q.id));

// The vote's first message: who has finished, and the button to finish.
export function voteStatusPanel(lobby: Lobby, vote: Vote): Panel {
  const done = new Set(vote.finished);
  return {
    tone: 'info',
    surface: 'vote',
    title: `Vote: Civ6 ${SHAPES[lobby.shape]} lobby`,
    subtitle: `Closes ${when(Date.parse(vote.ends_at), 'R')}, or once every player has finished`,
    body: [
      text('React on each setting below, as many options as you like, and on the bans with leader portraits. Then press Finished.'),
      field('Players', lobby.players.map((p) => `${done.has(p.discord_id) ? '✅' : '⬜'} ${mention(p.discord_id)}`).join('\n')),
    ],
    actions: [row(button(lobby, VERB.finished, 'Finished', ButtonStyle.Success))],
  };
}

export const voteCountedPanel = (lobby: Lobby): Panel => ({
  tone: 'success',
  surface: 'vote',
  title: `Vote: Civ6 ${SHAPES[lobby.shape]} lobby`,
  subtitle: lobby.status === 'done' ? 'Counted: the draft is on the lobby post' : 'Closed: the lobby was cancelled',
});

export const voteQuestionPanel = (question: SettingQuestion): Panel => ({
  tone: 'info',
  title: question.title,
  body: [text(question.options.map((o) => `${o.emoji} ${o.label}`).join('\n'))],
});

export function voteBansPanel(lobby: Lobby, names: CivNames): Panel {
  const need = Math.floor(lobby.players.length / 2) + 1;
  const hosts = lobby.bans.map((b) => nameOf(names, b.token)).join(' · ');
  return {
    tone: 'info',
    title: 'Leader bans',
    body: [
      text(`React with a leader's portrait to ban them. A ban lands with ${need} of the ${lobby.players.length} players.`),
      ...(hosts ? [field('Banned by the host', hosts)] : []),
    ],
  };
}
