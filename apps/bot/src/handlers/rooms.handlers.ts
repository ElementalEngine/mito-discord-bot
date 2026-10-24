import type { Interaction } from 'discord.js';

import { ApiClient } from '../api/index.js';
import { roomRanks } from '../services/roomranks.service.js';
import { parseId } from '../ui/kit/index.js';
import { ROOMS, roomPanel } from '../ui/panels/stats.js';
import { fail, holdPanel, refuse, replacePanel } from '../ui/reply.js';

const api = new ApiClient();

// Previous and Next on a /roomranks panel, turned by the member who ran it.
export async function handleRoomsInteraction(interaction: Interaction): Promise<boolean> {
  if (!interaction.isButton()) return false;
  const id = parseId(interaction.customId);
  if (id?.surface !== ROOMS.surface || id.verb !== ROOMS.page) return false;
  try {
    const [edition, voiceChannelId, pageText, asker] = id.args;
    if (!edition || !voiceChannelId || !asker || !interaction.guild) refuse('That button is out of date. Run /roomranks again.');
    if (interaction.user.id !== asker) refuse('Run /roomranks to page through the room yourself.');
    const civVersion = edition === 'civ7' ? 'civ7' : 'civ6';
    await holdPanel(interaction);
    const room = await roomRanks(interaction.guild, voiceChannelId, civVersion, api);
    await replacePanel(interaction, roomPanel(room.pages, Number(pageText) || 0, { civVersion, voiceChannelId, asker }, room.players));
  } catch (error) {
    await fail(interaction, error, 'turn the page', { customId: interaction.customId });
  }
  return true;
}
