import { GuildMember, InteractionContextType, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';

import { ApiClient } from '../../api/index.js';
import { config } from '../../config.js';
import { teamsPanel } from '../../ui/panels/stats.js';
import { refuse, respond } from '../../ui/reply.js';
import { editionOf, editionOption } from '../../utils/edition.js';
import { ensureCommandAccess } from '../../utils/ensure-command-access.js';
import { normalizePlayerList } from '../../utils/player-list.js';
import { STATS_POLICY } from '../../utils/stats-options.js';

const api = new ApiClient();

const SNOWFLAKE = /^\d{17,20}$/;

export const data = new SlashCommandBuilder()
  .setContexts(InteractionContextType.Guild)
  .setName('teamgen')
  .setDescription('Create two balanced teams to compete.')
  .addStringOption(editionOption)
  .addStringOption((opt) =>
    opt
      .setName('discord-ids')
      .setDescription('Cloud channel only: the players, as mentions or ids')
      .setRequired(false),
  );

export const visibility = 'public';

// Realtime players are whoever is in the caller's voice channel; a cloud game
// has no voice channel, so its players are listed.
function playersOf(interaction: ChatInputCommandInteraction, cloud: boolean): string[] {
  if (cloud) {
    const listed = normalizePlayerList(interaction.options.getString('discord-ids') ?? '')
      .split(' ')
      .filter((id) => SNOWFLAKE.test(id));
    if (listed.length < 2) refuse('List at least two players in discord-ids, as mentions or ids.');
    return [...new Set(listed)];
  }
  if (!(interaction.member instanceof GuildMember)) refuse('Run /teamgen in the server, not in a DM.');
  const voice = interaction.member.voice.channel;
  if (!voice) refuse('Join a voice channel first, then run /teamgen.');
  const ids = [...voice.members.values()].filter((m) => !m.user.bot).map((m) => m.user.id);
  if (ids.length < 2) refuse('At least two players need to be in your voice channel.');
  return ids;
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!(await ensureCommandAccess(interaction, STATS_POLICY))) return;
  const civVersion = editionOf(interaction);
  const cloud = interaction.channelId === config.discord.channels.cloudCommands;
  const ids = playersOf(interaction, cloud);
  const result = await api.getTeamGen(civVersion, cloud ? 'cloud' : 'realtime', ids);
  await respond(interaction, teamsPanel(result), 'public');
}
