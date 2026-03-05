import type {
  Interaction,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
  ButtonInteraction,
} from 'discord.js';

import {
  handleGameVoteButton,
  handleGameVoteModal,
  handleGameVoteSelect,
} from '../services/gamevote.service.js';

export async function handleGameVoteInteraction(
  interaction: Interaction
): Promise<boolean> {
  if (interaction.isButton()) {
    return handleGameVoteButton(interaction as ButtonInteraction);
  }

  if (interaction.isStringSelectMenu()) {
    return handleGameVoteSelect(interaction as StringSelectMenuInteraction);
  }

  if (interaction.isModalSubmit()) {
    return handleGameVoteModal(interaction as ModalSubmitInteraction);
  }

  return false;
}
