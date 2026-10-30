import { InteractionContextType, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';

import { startSecretVote } from '../../handlers/secret-vote.handlers.js';
import { ACTIONS, type Action } from '../../services/secret-vote.js';
import { refuse } from '../../ui/reply.js';
import { ensureCommandAccess } from '../../utils/ensure-command-access.js';
import { playersOption, votersOf } from '../../utils/voters.js';

export const data = new SlashCommandBuilder()
  .setName('secretvote')
  .setDescription('A secret YES/NO vote for your voice channel, open for 2 minutes.')
  .setContexts(InteractionContextType.Guild)
  .addStringOption((o) =>
    o
      .setName('action')
      .setDescription('What is voted on')
      .setRequired(true)
      .addChoices(...ACTIONS.map((a) => ({ name: a, value: a }))),
  )
  .addIntegerOption((o) => o.setName('turn').setDescription('The game turn').setRequired(true).setMinValue(1).setMaxValue(9999))
  .addStringOption((o) => o.setName('details').setDescription('What it is for, such as "CC order: adam, jeff, tim"').setRequired(true).setMaxLength(500))
  .addStringOption(playersOption);

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.inCachedGuild()) refuse('Secret votes are run in a server.');
  if (!(await ensureCommandAccess(interaction))) return;
  const action = interaction.options.getString('action', true) as Action;
  const turn = interaction.options.getInteger('turn', true);
  if (action === 'Remap' && turn > 10) refuse(`A remap is voted on by turn 10; this is turn ${turn}.`);
  const details = interaction.options.getString('details', true);
  await startSecretVote(interaction, { action, turn, details, hostId: interaction.user.id, ...votersOf(interaction) });
}
