import type {
  ButtonInteraction,
  Interaction,
  StringSelectMenuInteraction,
} from 'discord.js';

import { handleBlindDraftButton, handleBlindDraftSelect } from '../services/draftmodes/blind.js';
import { handleCwcDraftButton, handleCwcDraftSelect } from '../services/draftmodes/cwc.js';

export async function handleDraftingInteraction(
  interaction: Interaction,
): Promise<boolean> {
  if (interaction.isButton()) {
    if (await handleCwcDraftButton(interaction as ButtonInteraction)) return true;
    return handleBlindDraftButton(interaction as ButtonInteraction);
  }

  if (interaction.isStringSelectMenu()) {
    if (await handleCwcDraftSelect(interaction as StringSelectMenuInteraction)) return true;
    return handleBlindDraftSelect(interaction as StringSelectMenuInteraction);
  }

  return false;
}
