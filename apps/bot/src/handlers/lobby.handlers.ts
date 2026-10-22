import type { Interaction } from 'discord.js';

import { fail } from '../ui/reply.js';

// Any guild member may open a lobby. The voice channel is on the panel as
// information; nothing stops a seat being taken from outside it.
export async function handleLobbyInteraction(interaction: Interaction): Promise<boolean> {
  if (!interaction.isButton() || !interaction.customId.startsWith('lobby:')) return false;

  try {
    await interaction.launchActivity();
  } catch (error) {
    await fail(interaction, error, 'open the Activity', { customId: interaction.customId });
  }
  return true;
}
