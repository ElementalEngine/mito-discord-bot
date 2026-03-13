import type {
  Interaction,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
  ButtonInteraction,
} from 'discord.js';

import {
  handleGameVoteButtonInteraction,
  handleGameVoteModalInteraction,
  handleGameVoteSelectInteraction,
} from './voting.handlers.js';

export async function handleGameVoteInteraction(
  interaction: Interaction
): Promise<boolean> {
  if (interaction.isButton()) {
    return handleGameVoteButtonInteraction(interaction as ButtonInteraction);
  }

  if (interaction.isStringSelectMenu()) {
    return handleGameVoteSelectInteraction(interaction as StringSelectMenuInteraction);
  }

  if (interaction.isModalSubmit()) {
    return handleGameVoteModalInteraction(interaction as ModalSubmitInteraction);
  }

  return false;
}
