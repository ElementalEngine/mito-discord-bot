import { ButtonBuilder, ButtonStyle } from 'discord.js';

import { resultOf, ruleOf, type Choice, type SecretVote } from '../../services/secret-vote.js';
import { customId, field, mention, type Block, type Panel } from '../kit/index.js';
import { row } from './lobby.js';
import { closes, ticks } from './lobby-vote.js';

const CC_VETO = 'Anyone using a veto DMs the host in game chat within 2 minutes; with no veto, the CC passes.';
const IRREL_CHECKS = 'The player is in the bottom two by score, AI included, holds no veto and is in no ongoing emergency.';

const titleOf = (vote: SecretVote): string => `Secret vote: ${vote.action} · turn ${vote.turn}`;
const timed = (vote: SecretVote) => ({ deadline: vote.deadline, players: vote.voters.map((id) => ({ discord_id: id })) });
const about = (vote: SecretVote): Block[] => [field('Details', vote.details), field('Rule', ruleOf(vote.action, vote.turn).text)];

const button = (vote: SecretVote, choice: Choice, style: ButtonStyle): ButtonBuilder =>
  new ButtonBuilder().setCustomId(customId('secretvote', choice, vote.id)).setLabel(choice.toUpperCase()).setStyle(style);

// The open vote: what it is for, its rule, who has voted, and YES and NO.
export function secretVotePanel(vote: SecretVote): Panel {
  return {
    tone: 'info',
    surface: 'secretvote',
    title: titleOf(vote),
    subtitle: closes(timed(vote), 'voted'),
    body: [...about(vote), field('Voters', ticks(timed(vote), new Set(vote.choices.keys())))],
    actions: [row(button(vote, 'yes', ButtonStyle.Success), button(vote, 'no', ButtonStyle.Danger))],
    footer: `Started by ${mention(vote.hostId)} · Only you see your choice; no vote by the close counts as YES`,
  };
}

// The closed vote: its counts, who did not vote, and what the host does next.
export function secretResultPanel(vote: SecretVote): Panel {
  const { yes, no, passed, silent } = resultOf(vote);
  const notes =
    vote.action === 'Irrel' ? [field('Host checks', IRREL_CHECKS)] : vote.action === 'CC' && passed ? [field('Veto', CC_VETO)] : [];
  return {
    tone: passed ? 'success' : 'failed',
    surface: 'secretvote',
    title: titleOf(vote),
    subtitle: `${passed ? 'Passed' : 'Failed'}: ${yes} YES · ${no} NO`,
    body: [...about(vote), ...(silent.length ? [field('No vote, counted as YES', silent.map(mention).join(' '))] : []), ...notes],
    footer: `Started by ${mention(vote.hostId)}`,
  };
}
