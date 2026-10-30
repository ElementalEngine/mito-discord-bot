import { GuildMember, InteractionContextType, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';

import { ApiClient } from '../../api/index.js';
import { roomRanks } from '../../services/roomranks.service.js';
import { roomPanel } from '../../ui/panels/stats.js';
import { refuse, respond } from '../../ui/reply.js';
import { editionOf, editionOption } from '../../utils/edition.js';
import { ensureCommandAccess } from '../../utils/ensure-command-access.js';

const api = new ApiClient();

export const data = new SlashCommandBuilder()
  .setName('roomranks')
  .setDescription('Show stats for everyone currently in your voice channel.')
  .setContexts(InteractionContextType.Guild)
  .addStringOption(editionOption);

export const visibility = 'public';

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!(await ensureCommandAccess(interaction))) return;
  const civVersion = editionOf(interaction);
  if (!(interaction.member instanceof GuildMember) || !interaction.guild) refuse('Run /roomranks in the server, not in a DM.');
  const voice = interaction.member.voice.channel;
  if (!voice) refuse('Join a voice channel first, then run /roomranks.');
  const room = await roomRanks(interaction.guild, voice.id, civVersion, api);
  await respond(interaction, roomPanel(room.pages, 0, { civVersion, voiceChannelId: voice.id, asker: interaction.user.id }, room.players), 'public');
}
