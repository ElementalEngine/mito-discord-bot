import { MessageFlags, type Interaction } from 'discord.js';

import { EMOJI_FAIL } from '../config/constants.js';
import { log } from '../utils/log.js';

// Any guild member may open a lobby. The voice channel is on the embed as
// information; nothing stops a seat being taken from outside it.
export async function handleLobbyInteraction(interaction: Interaction): Promise<boolean> {
  if (!interaction.isButton() || !interaction.customId.startsWith('lobby:')) return false;

  try {
    await interaction.launchActivity();
  } catch (error) {
    log.error('launchActivity failed', error);
    await interaction.reply({ content: `${EMOJI_FAIL} Could not open the Activity.`, flags: MessageFlags.Ephemeral });
  }
  return true;
}
