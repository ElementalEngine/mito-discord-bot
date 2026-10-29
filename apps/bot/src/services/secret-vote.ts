import type { ChatInputCommandInteraction } from 'discord.js';

import { refuse } from '../ui/reply.js';

export const ACTIONS = ['CC', 'Irrel', 'Remap', 'Scrap'] as const;
export type Action = (typeof ACTIONS)[number];
export type Choice = 'yes' | 'no';
const VOTE_MS = 2 * 60_000;

export type SecretVote = Readonly<{
  id: string;
  action: Action;
  turn: number;
  details: string;
  hostId: string;
  voiceId: string;
  voters: readonly string[];
  deadline: string;
  // The command's public reply, where the vote is shown and redrawn.
  reply: ChatInputCommandInteraction;
  choices: Map<string, Choice>;
}>;

// Open votes, one per voice channel, kept in memory: a restart ends them.
const open = new Map<string, SecretVote>();

export function openSecretVote(vote: Omit<SecretVote, 'deadline' | 'choices'>): SecretVote {
  if ([...open.values()].some((v) => v.voiceId === vote.voiceId)) refuse('A secret vote is already running for your voice channel.');
  const opened: SecretVote = { ...vote, deadline: new Date(Date.now() + VOTE_MS).toISOString(), choices: new Map<string, Choice>() };
  open.set(opened.id, opened);
  return opened;
}

// One choice per voter, which stands once cast.
export function castIn(id: string, voterId: string, choice: Choice): SecretVote {
  const vote = open.get(id);
  if (!vote) refuse('This secret vote has closed.');
  if (!vote.voters.includes(voterId)) refuse('Only the players named on this vote take part.');
  if (vote.choices.has(voterId)) refuse('Your vote is already in.');
  vote.choices.set(voterId, choice);
  return vote;
}

export const isOpen = (id: string): boolean => open.has(id);

// The vote taken out of the open ones, once; later calls get nothing.
export function closeSecretVote(id: string): SecretVote | undefined {
  const vote = open.get(id);
  open.delete(id);
  return vote;
}

type Rule = Readonly<{ text: string; passes: (yes: number, no: number) => boolean }>;

const atMost = (most: number, turns: string): Rule => ({
  text: `${most ? `At most ${most} NO` : 'Unanimous'} (turn ${turns})`,
  passes: (_yes, no) => no <= most,
});

const share = (part: number, whole: number, turns: string): Rule => ({
  text: `${part}/${whole} YES (turn ${turns})`,
  passes: (yes, no) => yes * whole >= (yes + no) * part,
});

export function ruleOf(action: Action, turn: number): Rule {
  switch (action) {
    case 'CC':
      return turn <= 80 ? atMost(0, '1–80') : turn <= 100 ? atMost(1, '81–100') : atMost(2, '101+');
    case 'Scrap':
      return turn <= 20 ? share(2, 3, '1–20') : turn <= 50 ? share(3, 4, '21–50') : turn <= 70 ? atMost(1, '51–70') : atMost(0, '71+');
    case 'Irrel':
      return turn < 50 ? atMost(0, '1–49') : atMost(2, '50+');
    case 'Remap':
      return atMost(0, '1–10');
  }
}

// A voter with no choice by the close counts as YES.
export function resultOf(vote: Pick<SecretVote, 'action' | 'turn' | 'voters' | 'choices'>): { yes: number; no: number; passed: boolean; silent: string[] } {
  const no = vote.voters.filter((v) => vote.choices.get(v) === 'no').length;
  const yes = vote.voters.length - no;
  return { yes, no, passed: ruleOf(vote.action, vote.turn).passes(yes, no), silent: vote.voters.filter((v) => !vote.choices.has(v)) };
}
