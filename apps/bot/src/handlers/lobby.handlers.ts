import { MessageFlags, type Interaction } from 'discord.js';

import { EMOJI_FAIL } from '../config/constants.js';
import { BROWSE_LOBBIES_ID } from '../ui/embeds/lobby.js';
import { log } from '../utils/log.js';

// The bot decides who may open a lobby: the presser must be in the host's
// voice channel. The Activity then owns the seat, with identity stamped there.
export async function handleLobbyInteraction(interaction: Interaction): Promise<boolean> {
  if (!interaction.isButton() || !interaction.customId.startsWith('lobby:')) return false;

  if (interaction.customId !== BROWSE_LOBBIES_ID) {
    const [, , , voiceChannelId] = interaction.customId.split(':');
    const member = interaction.inCachedGuild() ? interaction.member : null;
    if (member?.voice.channelId !== voiceChannelId) {
      await interaction.reply({
        content: `${EMOJI_FAIL} Join <#${voiceChannelId}> first, then open the lobby.`,
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }
  }

  try {
    await interaction.launchActivity();
  } catch (error) {
    log.error('launchActivity failed', error);
    await interaction.reply({ content: `${EMOJI_FAIL} Could not open the Activity.`, flags: MessageFlags.Ephemeral });
  }
  return true;
}
