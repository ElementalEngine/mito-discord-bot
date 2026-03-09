import type {
  ButtonInteraction,
  Interaction,
  StringSelectMenuInteraction,
} from 'discord.js';

import { handleBlindDraftButton, handleBlindDraftSelect } from '../services/draftmodes/blind.js';

export async function handleDraftingInteraction(
  interaction: Interaction,
): Promise<boolean> {
  if (interaction.isButton()) {
    return handleBlindDraftButton(interaction as ButtonInteraction);
  }

  if (interaction.isStringSelectMenu()) {
    return handleBlindDraftSelect(interaction as StringSelectMenuInteraction);
  }

  return false;
}
