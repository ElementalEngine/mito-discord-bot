import type { ButtonInteraction, ChatInputCommandInteraction, Interaction } from 'discord.js';

import { dropDeadline, keepDeadline } from '../services/deadlines.js';
import { inLobbyTurn } from '../services/lobby.service.js';
import { castIn, closeSecretVote, isOpen, openSecretVote, type Choice, type SecretVote } from '../services/secret-vote.js';
import { parseId } from '../ui/kit/index.js';
import { secretResultPanel, secretVotePanel } from '../ui/panels/secret-vote.js';
import { fail, refuse, replacePanel, respond, say } from '../ui/reply.js';
import { log } from '../utils/log.js';

// Votes with a redraw waiting; presses meanwhile are drawn by that one.
const queued = new Set<string>();

const allIn = (vote: SecretVote): boolean => vote.choices.size === vote.voters.length;

// The vote posted as the command's public answer, pinging its voters.
export async function startSecretVote(interaction: ChatInputCommandInteraction, vote: Omit<SecretVote, 'id' | 'reply' | 'deadline' | 'choices'>): Promise<void> {
  const opened = openSecretVote({ ...vote, id: interaction.id, reply: interaction });
  try {
    await respond(interaction, secretVotePanel(opened), 'public', { allowedMentions: { users: [...opened.voters] } });
  } catch (error) {
    closeSecretVote(opened.id);
    throw error;
  }
  keepDeadline(opened.id, opened.deadline, () => close(opened.id));
}

async function close(id: string): Promise<void> {
  const vote = closeSecretVote(id);
  if (!vote) return;
  dropDeadline(id);
  await replacePanel(vote.reply, secretResultPanel(vote));
}

function redraw(vote: SecretVote): void {
  if (queued.has(vote.id)) return;
  queued.add(vote.id);
  void inLobbyTurn(vote.id, async () => {
    queued.delete(vote.id);
    if (isOpen(vote.id) && !allIn(vote)) await replacePanel(vote.reply, secretVotePanel(vote));
  }).catch((error: unknown) => log.warn('secret vote not redrawn', vote.id, error));
}

// The choice confirmed privately first; the vote closes once everyone is in.
async function cast(interaction: ButtonInteraction, id: string, choice: Choice): Promise<void> {
  const vote = castIn(id, interaction.user.id, choice);
  await say(interaction, 'success', `You voted ${choice.toUpperCase()}. Only you can see this.`);
  if (allIn(vote)) await inLobbyTurn(id, () => close(id));
  else redraw(vote);
}

export async function handleSecretVoteInteraction(interaction: Interaction): Promise<boolean> {
  if (!interaction.isButton()) return false;
  const id = parseId(interaction.customId);
  if (id?.surface !== 'secretvote') return false;
  try {
    if (id.verb !== 'yes' && id.verb !== 'no') refuse('This is out of date.');
    await cast(interaction, id.args[0] ?? '', id.verb);
  } catch (error) {
    await fail(interaction, error, 'record your vote', { customId: interaction.customId });
  }
  return true;
}
